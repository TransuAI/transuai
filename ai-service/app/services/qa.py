import logging
import uuid
from typing import Generator

import grpc
from sqlalchemy.orm import Session

from app.models import QaHistory
from app.repositories.embedding_repository import find_similar
from app.repositories.qa_repository import find_by_job_id
from app.services.embedder import embed_query
from app.services.default_models import resolve_chat_model, resolve_requested_chat_model
from app.services.llm_client import ChatModel, chat, stream_chat
from app.services.segment_times import time_key
from app.services.speaker_context import speaker_names_by_segment_time, with_speaker_name
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

_ANSWER_SYSTEM_PROMPT_TEMPLATE = (
    "你是一個逐字稿問答助手。請只根據以下逐字稿片段回答問題，用繁體中文回答；"
    "如果片段中找不到答案，就照實說沒有足夠資訊，不要編造。{speaker_instruction}\n\n{context}"
)
# 只有多位講者、片段帶了名字時才加：名字是講者目前的顯示名稱（可能剛被使用者改過）。
_SPEAKER_INSTRUCTION = "片段前面標了講者名稱（「名稱：內容」），回答時請用這些名字稱呼講者。"

# 對話記憶的範圍是整個 job（見 ai-service/docs/adr/ 對話範圍的 ADR），沒有獨立的
# conversation/thread 概念，所以這裡不需要 conversation_id，只需要 job_id 就能定位。
_CONDENSE_PROMPT_TEMPLATE = (
    "以下是使用者跟一個逐字稿問答助手的對話紀錄，以及使用者剛問的最新問題。\n\n"
    "如果最新問題本身語意已經完整、不需要對話紀錄就能理解，原封不動照抄輸出這個問題；"
    "如果它依賴對話紀錄才能理解（例如用了代名詞、省略了主詞或受詞、承接前一句的話題），"
    "把它改寫成一句不需要對話紀錄也能獨立理解的完整問題。"
    "只輸出結果本身，不要加任何說明、引號或前綴。\n\n"
    "對話紀錄：\n{history}\n\n最新問題：{question}"
)

_TOP_K = 5
# 回答前拿講者名字的等待上限：使用者正在等回答，逾時就不帶名字。
_TRANSCRIPT_TIMEOUT_SECONDS = 2.0
_MEMORY_TURNS = 5

# 歷史對話的答案長度沒有上限——一段很長的舊答案，就算只有一輪歷史也可能單獨把 prompt
# 撐得很大，所以每輪歷史塞進 prompt 前都先截斷，跟 _MEMORY_TURNS（要塞幾輪）是兩個獨立的
# 控制，不能只靠調輪數解決。
_MAX_HISTORY_ANSWER_CHARS = 300
# 平台模型關掉了 thinking mode（見 llm_client.DISABLE_THINKING），模型不會把
# 大量 token 燒在思考過程上，這裡的值只需要夠放「使用者真正會看到的答案」，不用像開著
# thinking mode 時那樣另外預留一大段給 chain-of-thought。
_ANSWER_MAX_TOKENS = 1024
_CONDENSE_MAX_TOKENS = 400


class NoEmbeddingsError(Exception):
    """這個 job 還沒有任何 embedding（pipeline 還沒跑完，或逐字稿沒有分段）。"""


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "（以下省略）"


def _condense_question(question: str, history: list[QaHistory], model: ChatModel, meter: UsageMeter) -> str:
    """有歷史時，用一次 LLM 呼叫同時做「要不要改寫」的語意判斷跟改寫本身：問題已經
    完整就原樣照抄，依賴前文才改寫成獨立問題。只影響檢索用的 query 向量，不影響存進
    qa_history 或顯示給使用者的原始問題文字，也不影響餵給 LLM 當作對話歷史的內容
    （那些都用使用者原本輸入的文字，改寫只是為了修正檢索語意，不是要竄改使用者問了什麼）。

    這裡塞進 prompt 的歷史答案有截斷（見 _MAX_HISTORY_ANSWER_CHARS），跟 stream_answer()
    餵給 LLM 當記憶的版本一致——只是為了判斷「這句話依不依賴前文」，用不到完整長度。
    """
    if not history:
        return question

    history_text = "\n".join(
        f"問：{turn.question}\n答：{_truncate(turn.answer, _MAX_HISTORY_ANSWER_CHARS)}" for turn in history
    )
    result = chat(model, [{
        "role": "user",
        "content": _CONDENSE_PROMPT_TEMPLATE.format(history=history_text, question=question),
    }], max_tokens=_CONDENSE_MAX_TOKENS, meter=meter)
    condensed = result.text.strip()
    return condensed or question


def stream_answer(
    session: Session,
    job_id: uuid.UUID,
    question: str,
    *,
    user_id: uuid.UUID | None,
    requested_model: tuple[str, str] | None = None,
) -> Generator[tuple[str, object], None, None]:
    """RAG 問答（含最近 `_MEMORY_TURNS` 輪對話記憶），streaming。

    yield 恰好一次 `("sources", list[float])`（在檢索完成、生成答案文字之前），接著恰好一次
    `("answered_by", (廠商, 模型))`，再接著任意數量的 `("delta", str)`。這個 function 本身不寫 DB——存不存 qa_history
    由呼叫端在成功收集完整答案之後才決定，半途失敗（例如 streaming 中斷）
    才不會留下不完整的紀錄。

    這個 job 沒有 embedding 時 raise NoEmbeddingsError、臨時指定的模型用不到時 raise ModelNotAvailable，都一定發生在
    任何 yield 之前。
    """
    # 這次用哪個模型：提問當下臨時指定的（用不到就在送出任何東西之前 raise ModelNotAvailable），否則是提問者的預設模型。
    if requested_model and user_id:
        model = resolve_requested_chat_model(user_id, *requested_model)
    else:
        model = resolve_chat_model(user_id)
    history = find_by_job_id(session, job_id)[-_MEMORY_TURNS:]

    condensed_question = _condense_question(question, history, model, UsageMeter(user_id, job_id, LlmFeature.QA_REWRITE))
    query_vector = embed_query(condensed_question)
    chunks = find_similar(session, job_id, query_vector, limit=_TOP_K)
    if not chunks:
        raise NoEmbeddingsError(f"no embeddings found for job {job_id}")

    speaker_by_time = _current_speaker_names_by_time(job_id)
    context = "\n\n".join(
        f"[{float(chunk.start_time):.1f}s] "
        + with_speaker_name(chunk.chunk_text, speaker_by_time.get(time_key(chunk.start_time, chunk.end_time)))
        for chunk in chunks
    )
    source_timestamps = [float(chunk.start_time) for chunk in chunks]
    yield ("sources", source_timestamps)
    yield ("answered_by", (model.provider, model.model))

    speaker_instruction = _SPEAKER_INSTRUCTION if speaker_by_time else ""
    messages = [{
        "role": "system",
        "content": _ANSWER_SYSTEM_PROMPT_TEMPLATE.format(speaker_instruction=speaker_instruction, context=context),
    }]
    for turn in history:
        messages.append({"role": "user", "content": turn.question})
        messages.append({"role": "assistant", "content": _truncate(turn.answer, _MAX_HISTORY_ANSWER_CHARS)})
    messages.append({"role": "user", "content": question})

    logger.info(
        "calling %s (%s) to stream-answer question for job %s, using %d chunks, %d history turns",
        model.provider, model.model, job_id, len(chunks), len(history),
    )
    meter = UsageMeter(user_id, job_id, LlmFeature.QA_ANSWER)
    for delta in stream_chat(model, messages, max_tokens=_ANSWER_MAX_TOKENS, meter=meter):
        yield ("delta", delta)


def _current_speaker_names_by_time(job_id: uuid.UUID) -> dict[tuple[float, float], str]:
    """embedding 只存片段文字，名字在回答當下才向 transcription-service 拿，改名後下一次提問就是新名字。拿不到
    逐字稿（失敗或逾時）時照樣回答，只是不帶名字——名字是加分，不值得讓整輪問答失敗或卡住。"""
    try:
        transcript = transcript_client.get_transcript(str(job_id), timeout=_TRANSCRIPT_TIMEOUT_SECONDS)
    except grpc.RpcError:
        logger.warning("job %s: could not fetch the transcript for speaker names, answering without them", job_id)
        return {}
    return speaker_names_by_segment_time(transcript)
