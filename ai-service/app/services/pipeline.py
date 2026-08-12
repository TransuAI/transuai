import json
import logging
import uuid
from typing import Callable

from app.db import new_session
from app.repositories.chapter_repository import save_chapters
from app.repositories.embedding_repository import save_embeddings
from app.repositories.summary_repository import save_summary
from app.services.chapter_generator import generate_chapters
from app.services.embedder import embed_documents
from app.services.job_status_client import job_status_client
from app.services.summarizer import summarize
from app.services.transcript_client import transcript_client

logger = logging.getLogger(__name__)


def process_message(
    body: bytes,
    publish_completed: Callable[[str], None],
    publish_failed: Callable[[str, str, str], None],
) -> None:
    """處理一則 transcription.completed 訊息：取逐字稿 -> 摘要 + 章節分段 + embedding -> 存 DB -> 回寫狀態 -> 發 ai.completed。

    章節分段、embedding 目前都沒有獨立的 Job status（見 architecture-design.md 3.4/4.4，還沒規劃新的
    stage），先併在既有的 SUMMARIZING 階段做，任何一步失敗都回寫 Job status=FAILED 並記錄 error_reason、
    發送 job.failed，不把例外往外拋——讓 consumer 正常 ack 這則訊息，避免永久性失敗（例如逐字稿不存在、額度用盡）造成無窮 requeue。
    """
    payload = json.loads(body)
    job_id: str = payload["jobId"]

    logger.info("processing job %s", job_id)

    try:
        job_status_client.update_status(job_id, "SUMMARIZING")

        transcript = transcript_client.get_transcript(job_id)
        segments = list(transcript.segments)
        summary_text = summarize(transcript.full_text)
        chapters = generate_chapters(segments)
        vectors = embed_documents([segment.text for segment in segments])

        session = new_session()
        try:
            save_summary(session, uuid.UUID(job_id), summary_text)
            save_chapters(session, uuid.UUID(job_id), chapters)
            save_embeddings(session, uuid.UUID(job_id), [
                (segment.text, segment.start_time, segment.end_time, vector)
                for segment, vector in zip(segments, vectors)
            ])
        finally:
            session.close()

        job_status_client.update_status(job_id, "COMPLETED")
        publish_completed(job_id)
        logger.info("job %s summarized successfully", job_id)
    except Exception as exc:
        logger.exception("job %s failed", job_id)
        error_reason = str(exc)[:500]
        try:
            job_status_client.update_status(
                job_id, "FAILED", error_reason=error_reason)
            publish_failed(job_id, "SUMMARIZING", error_reason)
        except Exception:
            # 回報失敗本身也失敗了（例如 job 在 upload-service 那邊已經不存在）。
            # 這裡一定要接住，不能讓例外繼續往外冒——冒出去會直接把 consumer thread 弄死，
            # 之後整個 process 都不會再消費新訊息（需要重啟才會恢復），比漏掉這一則訊息嚴重得多。
            logger.exception(
                "job %s: also failed to report FAILED status / publish job.failed, giving up on this message", job_id)
