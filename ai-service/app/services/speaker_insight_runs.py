"""講者數據的 AI 判斷要怎麼跑（判斷本身見 speaker_insights.py）：要求時把這個 Job 的那一份改成「分析中」並排入 ai-service 自己的
speaker_insights.requested queue，背景用要求者的預設模型分析，完成才換掉上一次的結果。做法照測驗（quizzes.py）。"""

import json
import logging
import uuid
from datetime import datetime, timezone

from pika import BlockingConnection
from sqlalchemy import delete, select

from app.db import new_session
from app.models import SpeakerInsightItem, SpeakerInsightRun, SpeakerInsightsStatus
from app.services.default_models import resolve_chat_model
from app.services.event_publisher import connection_params, publish_speaker_insights_requested
from app.services.llm_client import ChatModel, LlmError
from app.services.regeneration import STUCK_AFTER
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.speaker_context import speaker_names
from app.services.speaker_insights import Insight, InsightFormatError, analyze_speakers
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

STUCK_REASON = "分析逾時，請再分析一次"


class SpeakerInsightsNotQueued(Exception):
    """The request couldn't be put on the queue; nothing changed."""


def effective_status(run: SpeakerInsightRun, now: datetime | None = None) -> tuple[SpeakerInsightsStatus, str | None]:
    """「分析中」超過 STUCK_AFTER 的當成失敗（例如服務中途重啟），使用者才能再分析。"""
    now = now or datetime.now(timezone.utc)
    if run.status == SpeakerInsightsStatus.GENERATING and now - run.requested_at >= STUCK_AFTER:
        return SpeakerInsightsStatus.FAILED, STUCK_REASON
    return SpeakerInsightsStatus(run.status), run.failure_reason


def find_speaker_insights(job_id: uuid.UUID) -> tuple[SpeakerInsightRun | None, list[SpeakerInsightItem]]:
    with new_session() as session:
        run = session.scalar(select(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id))
        if run is None:
            return None, []
        items = session.scalars(select(SpeakerInsightItem).where(SpeakerInsightItem.run_id == run.id)
                                .order_by(SpeakerInsightItem.start_time, SpeakerInsightItem.kind.desc())).all()
        return run, list(items)


def request_speaker_insights(job_id: uuid.UUID, user_id: uuid.UUID) -> SpeakerInsightRun:
    """把這個 Job 的那一份改成「分析中」並排入 queue，立即回傳。已經在分析中（還沒卡住）就直接回傳它，不重複排。排入失敗時恢復
    原狀（第一次分析就刪掉），raise SpeakerInsightsNotQueued。"""
    with new_session() as session:
        run = session.scalar(select(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id).with_for_update())
        if run is not None and effective_status(run)[0] == SpeakerInsightsStatus.GENERATING:
            return run
        before = None if run is None else (run.status, run.failure_reason, run.requested_at, run.requested_by)
        if run is None:
            run = SpeakerInsightRun(job_id=job_id)
            session.add(run)
        run.requested_by, run.status, run.failure_reason = user_id, SpeakerInsightsStatus.GENERATING, None
        run.requested_at = datetime.now(timezone.utc)
        session.commit()
        try:
            _queue(str(job_id), str(user_id))
        except Exception as exc:
            logger.exception("could not queue speaker insights for job %s", job_id)
            if before is None:
                session.delete(run)
            else:
                run.status, run.failure_reason, run.requested_at, run.requested_by = before
            session.commit()
            raise SpeakerInsightsNotQueued() from exc
        return run


def _queue(job_id: str, user_id: str) -> None:
    # Runs inside the user's request: short timeouts, one connection attempt, publisher confirms (as quizzes.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_speaker_insights_requested(channel, job_id, user_id)
    finally:
        connection.close()


def process_speaker_insights_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 speaker_insights.requested { jobId, userId }：讀目前的逐字稿，用要求者的預設模型判斷問題與打斷，完成才換掉上一次的
    結果。格式不對是永久性失敗；暫時性失敗且還有重試預算時 raise RetryableMessageError；其他失敗設成「失敗」並附原因。"""
    payload = json.loads(body)
    job_id, user_id = uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    try:
        if not _still_generating(job_id):
            logger.info("speaker insights of job %s are no longer being generated, dropping the request", job_id)
            return
        transcript = transcript_client.get_transcript(str(job_id))
        if speaker_names(transcript) is None:
            _fail(job_id, "需要兩位以上講者才能分析")
            return
        model = resolve_chat_model(user_id)
        insights = analyze_speakers(transcript, model=model, meter=UsageMeter(user_id, job_id, LlmFeature.SPEAKER_INSIGHTS))
        _save(job_id, insights, transcript.revision, model)
    except InsightFormatError as exc:
        logger.warning("speaker insights of job %s: the model's reply was not valid: %s", job_id, exc)
        _fail(job_id, "模型回傳的格式不正確，請再分析一次")
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"speaker insights {job_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("analyzing the speakers of job %s failed", job_id)
        _fail(job_id, str(exc) if isinstance(exc, LlmError) else "分析失敗，請再試一次")
        return
    logger.info("analyzed the speakers of job %s from revision %s", job_id, transcript.revision)


def _still_generating(job_id: uuid.UUID) -> bool:
    with new_session() as session:
        run = session.scalar(select(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id))
        return run is not None and run.status == SpeakerInsightsStatus.GENERATING


def _save(job_id: uuid.UUID, insights: list[Insight], source_revision: int, model: ChatModel) -> None:
    with new_session() as session:
        run = session.scalar(select(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id).with_for_update())
        if run is None:
            return
        session.execute(delete(SpeakerInsightItem).where(SpeakerInsightItem.run_id == run.id))
        session.add_all([
            SpeakerInsightItem(run_id=run.id, kind=i.kind, speaker_label=i.speaker_label,
                               interrupted_label=i.interrupted_label, start_time=i.start_time, text=i.text)
            for i in insights])
        run.status, run.failure_reason = SpeakerInsightsStatus.COMPLETED, None
        run.source_revision, run.model_provider, run.model = source_revision, model.provider, model.model
        run.completed_at = datetime.now(timezone.utc)
        session.commit()


def _fail(job_id: uuid.UUID, reason: str) -> None:
    try:
        with new_session() as session:
            run = session.scalar(select(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id))
            if run is not None:
                run.status, run.failure_reason = SpeakerInsightsStatus.FAILED, reason
                session.commit()
    except Exception:
        # Can't even record the failure: it stays GENERATING and reads as failed after STUCK_AFTER.
        logger.exception("could not mark the speaker insights of job %s as failed", job_id)
