import json
import logging
import uuid
from typing import Callable

from app.db import new_session
from app.repositories.summary_repository import save_summary
from app.services.job_status_client import job_status_client
from app.services.summarizer import summarize
from app.services.transcript_client import transcript_client

logger = logging.getLogger(__name__)


def process_message(
    body: bytes,
    publish_completed: Callable[[str], None],
    publish_failed: Callable[[str, str, str], None],
) -> None:
    """處理一則 transcription.completed 訊息：取逐字稿 -> 摘要 -> 存摘要 -> 回寫狀態 -> 發 ai.completed。

    任何一步失敗都回寫 Job status=FAILED 並記錄 error_reason、發送 job.failed，
    不把例外往外拋——讓 consumer 正常 ack 這則訊息，避免永久性失敗（例如逐字稿不存在、額度用盡）造成無窮 requeue。
    """
    payload = json.loads(body)
    job_id: str = payload["jobId"]

    logger.info("processing job %s", job_id)

    try:
        job_status_client.update_status(job_id, "SUMMARIZING")

        transcript = transcript_client.get_transcript(job_id)
        summary_text = summarize(transcript.full_text)

        session = new_session()
        try:
            save_summary(session, uuid.UUID(job_id), summary_text)
        finally:
            session.close()

        job_status_client.update_status(job_id, "COMPLETED")
        publish_completed(job_id)
        logger.info("job %s summarized successfully", job_id)
    except Exception as exc:
        logger.exception("job %s failed", job_id)
        error_reason = str(exc)[:500]
        job_status_client.update_status(
            job_id, "FAILED", error_reason=error_reason)
        publish_failed(job_id, "SUMMARIZING", error_reason)
