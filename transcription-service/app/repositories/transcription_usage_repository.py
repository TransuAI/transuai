import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
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
