import logging
import uuid
from typing import Iterator

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import QaHistory
from app.repositories.embedding_repository import find_similar
from app.repositories.qa_repository import find_by_job_id
from app.services.embedder import embed_query
from app.services.groq_client import get_client, strip_thinking, stream_without_thinking

logger = logging.getLogger(__name__)

_ANSWER_SYSTEM_PROMPT_TEMPLATE = (
    "你是一個逐字稿問答助手。請只根據以下逐字稿片段回答問題，用繁體中文回答；"
    "如果片段中找不到答案，就照實說沒有足夠資訊，不要編造：\n\n{context}"
)

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
_MEMORY_TURNS = 5

# qwen/qwen3.6-27b 免費層 TPM（tokens per minute）只有 8000（見 README 已知限制），單一請求的
# prompt + 保留的 completion 預算都算在裡面。歷史對話的答案長度沒有上限——一段很長的舊答案，
# 就算只有一輪歷史也可能單獨把預算吃光，所以每輪歷史塞進 prompt 前都先截斷，跟 _MEMORY_TURNS
# （要塞幾輪）是兩個獨立的預算控制，不能只靠調輪數解決。
_MAX_HISTORY_ANSWER_CHARS = 300
# 完全不設 max_completion_tokens 的話，Groq 的 TPM 預估會把「這個模型剩餘的 context 空間」
# 整段算進 Requested 用量（qwen3.6-27b 是 reasoning model，預留空間本來就大），輕易就超過
# 8000 的免費層上限。這裡的值要留夠 reasoning model 內部的 <think> chain-of-thought 用量
# （reasoning_format="hidden" 對這個 preview 模型沒作用，thinking 照樣佔掉 completion tokens，
# 見 groq_client.strip_thinking() 的註解），不能只算「使用者真正會看到的答案」需要多少字。
_ANSWER_MAX_COMPLETION_TOKENS = 1024
_CONDENSE_MAX_COMPLETION_TOKENS = 400


class NoEmbeddingsError(Exception):
    """這個 job 還沒有任何 embedding（pipeline 還沒跑完，或逐字稿沒有分段）。"""


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "（以下省略）"


def _condense_question(question: str, history: list[QaHistory]) -> str:
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
    response = get_client().chat.completions.create(
        model=settings.ai_groq_model,
        messages=[{
            "role": "user",
            "content": _CONDENSE_PROMPT_TEMPLATE.format(history=history_text, question=question),
        }],
        reasoning_format="hidden",
        max_completion_tokens=_CONDENSE_MAX_COMPLETION_TOKENS,
    )
    condensed = strip_thinking(response.choices[0].message.content or "").strip()
    return condensed or question


def stream_answer(session: Session, job_id: uuid.UUID, question: str) -> Iterator[tuple[str, object]]:
    """RAG 問答（含最近 `_MEMORY_TURNS` 輪對話記憶），streaming。

    yield 恰好一次 `("sources", list[float])`（在檢索完成、生成答案文字之前），
    接著任意數量的 `("delta", str)`。這個 function 本身不寫 DB——存不存 qa_history
    由呼叫端在成功收集完整答案之後才決定，半途失敗（例如 streaming 中斷）
    才不會留下不完整的紀錄。

    這個 job 沒有 embedding 時 raise NoEmbeddingsError，一定發生在任何 yield 之前。
    """
    history = find_by_job_id(session, job_id)[-_MEMORY_TURNS:]

    condensed_question = _condense_question(question, history)
    query_vector = embed_query(condensed_question)
    chunks = find_similar(session, job_id, query_vector, limit=_TOP_K)
    if not chunks:
        raise NoEmbeddingsError(f"no embeddings found for job {job_id}")

    context = "\n\n".join(f"[{float(chunk.start_time):.1f}s] {chunk.chunk_text}" for chunk in chunks)
    source_timestamps = [float(chunk.start_time) for chunk in chunks]
    yield ("sources", source_timestamps)

    messages = [{"role": "system", "content": _ANSWER_SYSTEM_PROMPT_TEMPLATE.format(context=context)}]
    for turn in history:
        messages.append({"role": "user", "content": turn.question})
        messages.append({"role": "assistant", "content": _truncate(turn.answer, _MAX_HISTORY_ANSWER_CHARS)})
    messages.append({"role": "user", "content": question})

    logger.info(
        "calling Groq (%s) to stream-answer question for job %s, using %d chunks, %d history turns",
        settings.ai_groq_model, job_id, len(chunks), len(history),
    )
    stream = get_client().chat.completions.create(
        model=settings.ai_groq_model,
        messages=messages,
        reasoning_format="hidden",
        max_completion_tokens=_ANSWER_MAX_COMPLETION_TOKENS,
        stream=True,
    )
    raw_deltas = (chunk.choices[0].delta.content for chunk in stream)
    for delta in stream_without_thinking(raw_deltas):
        yield ("delta", delta)
