import json
import logging
import uuid
from typing import Callable

from app.db import new_session
from app.repositories.chapter_repository import save_chapters
from app.repositories.embedding_repository import save_embeddings
from app.repositories.speaker_suggestion_repository import save_speaker_suggestions
from app.repositories.summary_repository import save_summary
from app.services.chapter_generator import generate_chapters
from app.services.default_models import resolve_chat_model
from app.services.embedder import embed_documents
from app.services.job_details import suggest_details
from app.services.job_status_client import job_status_client
from app.services.llm_client import ChatModel
from app.services.speaker_names import suggest_speaker_names
from app.services.retry import (
    TERMINAL_FAILURE_LOST_MARKER,
    RetryableMessageError,
    is_retryable_error,
    has_retry_budget,
    retry_terminal_report,
)
from app.services.speaker_context import chapter_input, speaker_names, spoken_segments, summary_input
from app.services.summarizer import summarize
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter, job_owner

logger = logging.getLogger(__name__)


def process_message(
    body: bytes,
    publish_completed: Callable[[str], None],
    publish_failed: Callable[[str, str, str], None],
    retry_count: int = 0,
) -> None:
    """處理一則 transcription.completed 訊息：取逐字稿 -> 摘要 + 章節分段 + embedding -> 存 DB -> 回寫狀態 -> 發 ai.completed。

    章節分段、embedding 目前都沒有獨立的 Job status（見 architecture-design.md 3.4/4.4，還沒規劃新的
    stage），先併在既有的 SUMMARIZING 階段做。

    `retry_count` 是這則訊息目前已經被重新投遞過幾次（由 consumer.py 從訊息 header 讀出、傳進來），
    第一次送達永遠是 0。任一步失敗時：
    - 失敗被分類為暫時性（HF/gRPC，見 app/services/retry.py）且還沒到重試預算上限
      -> raise RetryableMessageError，不落入下面的 FAILED 路徑，交給 consumer.py 決定送去哪條 retry queue。
    - 其他情況（永久性失敗、或暫時性失敗但預算已用盡）-> 維持現狀回寫 Job status=FAILED、記錄
      error_reason、發送 job.failed；這個回報動作本身也可能因為暫時性 gRPC 錯誤失敗，用
      retry_terminal_report() 做獨立、快速的重試，重試仍失敗則只記錄一則好搜尋的 log，不把例外
      往外拋——讓 consumer 正常 ack 這則訊息，避免無窮 requeue。
    """
    payload = json.loads(body)
    job_id: str = payload["jobId"]
    user_id = job_owner(payload)  # 用量記在他名下

    logger.info("processing job %s (retry_count=%d)", job_id, retry_count)

    try:
        job_status_client.update_status(job_id, "SUMMARIZING")

        transcript = transcript_client.get_transcript(job_id)
        # Cleared segments (empty text, 已清空片段) aren't content: leave them out of every AI input.
        segments = spoken_segments(transcript)
        job_uuid = uuid.UUID(job_id)
        model = resolve_chat_model(user_id)  # Job 擁有者的預設模型
        summary_text = summarize(
            summary_input(transcript), model=model, meter=UsageMeter(user_id, job_uuid, LlmFeature.SUMMARY))
        chapters = generate_chapters(
            chapter_input(transcript), model=model, meter=UsageMeter(user_id, job_uuid, LlmFeature.CHAPTERS))
        vectors = embed_documents([segment.text for segment in segments])

        session = new_session()
        try:
            save_summary(session, uuid.UUID(job_id), summary_text, source_revision=transcript.revision,
                         model=(model.provider, model.model))
            save_chapters(session, uuid.UUID(job_id), chapters)
            save_embeddings(session, uuid.UUID(job_id), [
                (segment.text, segment.start_time, segment.end_time, vector)
                for segment, vector in zip(segments, vectors)
            ])
        finally:
            session.close()

        _suggest_title_and_category(job_id, summary_text, chapters, model=model,
                                    meter=UsageMeter(user_id, job_uuid, LlmFeature.JOB_TITLE))
        _suggest_speaker_names(job_uuid, transcript, model=model,
                               meter=UsageMeter(user_id, job_uuid, LlmFeature.SPEAKER_NAMES))
        job_status_client.update_status(job_id, "COMPLETED")
        publish_completed(job_id)
        logger.info("job %s summarized successfully", job_id)
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(
                f"job {job_id}: transient failure, retry_count={retry_count}") from exc

        logger.exception("job %s failed", job_id)
        error_reason = str(exc)[:500]

        def _report_failure() -> None:
            job_status_client.update_status(
                job_id, "FAILED", error_reason=error_reason)
            publish_failed(job_id, "SUMMARIZING", error_reason)

        # 回報失敗本身也可能因為暫時性 gRPC 錯誤失敗（見 retry_terminal_report）。這裡一定要接住
        # 重試仍然失敗的結果，不能讓例外繼續往外冒——冒出去會直接把 consumer thread 弄死，
        # 之後整個 process 都不會再消費新訊息（需要重啟才會恢復），比漏掉這一則訊息嚴重得多。
        if not retry_terminal_report(_report_failure):
            logger.error(
                "%s job=%s could not report FAILED status / publish job.failed even after retries",
                TERMINAL_FAILURE_LOST_MARKER, job_id)


def _suggest_title_and_category(job_id: str, summary: str, chapters: list[tuple[str, float]], *, model: ChatModel,
                                meter: UsageMeter) -> None:
    """替 Job 取標題、判斷類型並回寫（在 COMPLETED 之前，列表一完成就看得到）。只是方便找檔案的附加功能：任何失敗
    只記 log，不重試、不讓 Job 失敗。"""
    try:
        details = suggest_details(summary, chapters, model=model, meter=meter)
        if details:
            job_status_client.set_suggested_details(job_id, details.title, details.category)
    except Exception:
        logger.exception("job %s: could not give it a title, it keeps its file name", job_id)


def _suggest_speaker_names(job_uuid: uuid.UUID, transcript, *, model: ChatModel, meter: UsageMeter) -> None:
    """講者名字建議（兩位以上講者才問模型）。附加功能：任何失敗只記 log，講者照舊是「講者 N」，Job 照樣完成。"""
    if speaker_names(transcript) is None:
        return
    try:
        suggestions = suggest_speaker_names(transcript, model=model, meter=meter)
        if suggestions is not None:
            save_speaker_suggestions(job_uuid, suggestions)
    except Exception:
        logger.exception("job %s: could not suggest speaker names", job_uuid)

