import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import new_session
from app.models import TranscriptionUsage


@dataclass(frozen=True)
class TranscriptionUsageRecord:
    user_id: uuid.UUID | None
    job_id: uuid.UUID
    provider: str
    model: str
    audio_seconds: float | None
    succeeded: bool
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def save_transcription_usage(record: TranscriptionUsageRecord) -> None:
    """用自己的 session 立即寫入：轉錄後面的步驟（存逐字稿、回寫狀態）失敗，用量也要留下。"""
    session = new_session()
    try:
        session.add(TranscriptionUsage(
            user_id=record.user_id, job_id=record.job_id, provider=record.provider, model=record.model,
            audio_seconds=record.audio_seconds, succeeded=record.succeeded, created_at=record.created_at,
        ))
        session.commit()
    finally:
        session.close()


def list_job_transcription_usage(session: Session, job_id: uuid.UUID) -> list[TranscriptionUsage]:
    return list(session.scalars(
        select(TranscriptionUsage)
        .where(TranscriptionUsage.job_id == job_id)
        .order_by(TranscriptionUsage.created_at, TranscriptionUsage.id)))


@dataclass(frozen=True)
class TranscriptionUsageSum:
    provider: str
    model: str
    audio_seconds: float  # 已知秒數的加總
    calls: int
    calls_with_unknown_usage: int


def sum_user_transcription_usage(
    session: Session, user_id: uuid.UUID, start: datetime, end: datetime
) -> list[TranscriptionUsageSum]:
    """一位使用者在 [start, end) 之間的轉錄用量，依廠商、模型加總。"""
    rows = session.execute(
        select(
            TranscriptionUsage.provider, TranscriptionUsage.model,
            func.coalesce(func.sum(TranscriptionUsage.audio_seconds), 0.0),
            func.count(), func.count().filter(TranscriptionUsage.audio_seconds.is_(None)),
        )
        .where(TranscriptionUsage.user_id == user_id, TranscriptionUsage.created_at >= start,
               TranscriptionUsage.created_at < end)
        .group_by(TranscriptionUsage.provider, TranscriptionUsage.model)
        .order_by(TranscriptionUsage.provider, TranscriptionUsage.model))
    return [TranscriptionUsageSum(*row) for row in rows]
