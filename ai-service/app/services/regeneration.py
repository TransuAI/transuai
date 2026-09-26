import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from pika import BlockingConnection

from app.db import new_session
from app.models import RegenerationStatus, Summary
from app.repositories.summary_repository import lock_summary, mark_regeneration_failed, replace_summary_and_chapters
from app.services.chapter_generator import generate_chapters
from app.services.event_publisher import connection_params, publish_regeneration_requested
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.summarizer import summarize
from app.services.transcript_client import transcript_client

logger = logging.getLogger(__name__)

# A RUNNING regeneration older than this is assumed stuck (e.g. the service restarted mid-way),
# so the user may request it again.
STUCK_AFTER = timedelta(minutes=5)


def effective_regeneration_status(summary: Summary, now: datetime | None = None) -> RegenerationStatus:
    """對外回報的狀態：RUNNING 卻已經超過 STUCK_AFTER 的，當成 FAILED——使用者才看得到重試的按鈕
    （RequestRegeneration 也允許重新排入這種卡住的請求）。"""
    status = RegenerationStatus(summary.regeneration_status)
    requested_at = summary.regeneration_requested_at
    now = now or datetime.now(timezone.utc)
    if status == RegenerationStatus.RUNNING and (requested_at is None or now - requested_at >= STUCK_AFTER):
        return RegenerationStatus.FAILED
    return status


class SummaryNotFound(Exception):
    """The job has no summary yet (its pipeline hasn't finished)."""


class RegenerationNotQueued(Exception):
    """The request couldn't be put on the queue; nothing was changed."""


def _queue(job_id: str) -> None:
    # Runs inside the user's request: short timeouts, one connection attempt, publisher confirms
    # (the same approach as transcription-service's transcript.edited).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_regeneration_requested(channel, job_id)
    finally:
        connection.close()


def request_regeneration(job_id: uuid.UUID) -> Summary:
    """使用者要求重新產生摘要與章節：狀態設成 RUNNING 並排入 ai-service 自己的 queue，回傳目前的摘要。
    已經在跑（且沒有卡住）時什麼都不做。排入失敗時整個 rollback、狀態不變。Job 狀態完全不碰——工作區
    只在 COMPLETED 時顯示，重新產生期間使用者必須留在工作區。"""
    session = new_session()
    try:
        summary = lock_summary(session, job_id)
        if summary is None:
            raise SummaryNotFound()
        now = datetime.now(timezone.utc)
        if effective_regeneration_status(summary, now) == RegenerationStatus.RUNNING:
            session.commit()  # already running (not stuck): just release the row lock
            return summary
        summary.regeneration_status = RegenerationStatus.RUNNING
        summary.regeneration_requested_at = now
        session.flush()
        try:
            _queue(str(job_id))
        except Exception as exc:
            session.rollback()
            logger.exception("could not queue a regeneration for job %s", job_id)
            raise RegenerationNotQueued() from exc
        session.commit()
        return summary
    finally:
        session.close()


def process_regeneration_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 summary.regeneration.requested { jobId }：依最新的逐字稿（排除已清空片段）重新產生
    摘要與章節、覆寫兩者，source_revision 記成讀到的 revision（重新產生期間又被編輯的話，完成後仍然
    正確地顯示過時），狀態回到 IDLE。兩個 LLM 呼叫都成功才寫入，不會只換掉一半。

    暫時性失敗且還有重試預算時 raise RetryableMessageError（這個 queue 自己的 retry queue）；最終失敗
    時狀態設成 FAILED、舊內容保留。Job 狀態與 ai.completed / job.failed 一律不碰。
    """
    job_id = json.loads(body)["jobId"]
    try:
        transcript = transcript_client.get_transcript(job_id)
        segments = [segment for segment in transcript.segments if segment.text != ""]
        summary_text = summarize(transcript.full_text)
        chapters = generate_chapters(segments)
        session = new_session()
        try:
            replace_summary_and_chapters(
                session, uuid.UUID(job_id), summary_text, chapters, source_revision=transcript.revision)
        finally:
            session.close()
        logger.info("regenerated summary and chapters for job %s from revision %s", job_id, transcript.revision)
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"job {job_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("regenerating summary and chapters for job %s failed", job_id)
        _mark_failed(job_id)


def _mark_failed(job_id: str) -> None:
    session = new_session()
    try:
        mark_regeneration_failed(session, uuid.UUID(job_id))
    except Exception:
        # Can't even record the failure (e.g. the database is down): the row stays RUNNING and reads
        # as FAILED once it's older than STUCK_AFTER, so the user can still retry.
        logger.exception("could not mark the regeneration of job %s as failed", job_id)
    finally:
        session.close()
