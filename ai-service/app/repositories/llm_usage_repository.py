import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import new_session
from app.models import LlmUsage


@dataclass(frozen=True)
class LlmUsageRecord:
    user_id: uuid.UUID | None
    job_id: uuid.UUID
    feature: str
    provider: str
    model: str
    key_source: str
    input_tokens: int | None
    output_tokens: int | None
    succeeded: bool
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def save_llm_usage(record: LlmUsageRecord) -> None:
    """用自己的 session 立即寫入：用量跟呼叫它的流程（摘要存檔、問答紀錄）無關，流程後面失敗也要留下。"""
    session = new_session()
    try:
        session.add(LlmUsage(
            user_id=record.user_id, job_id=record.job_id, feature=record.feature, provider=record.provider,
            model=record.model, key_source=record.key_source, input_tokens=record.input_tokens,
            output_tokens=record.output_tokens, succeeded=record.succeeded, created_at=record.created_at,
        ))
        session.commit()
    finally:
        session.close()


def list_job_llm_usage(session: Session, job_id: uuid.UUID) -> list[LlmUsage]:
    return list(session.scalars(
        select(LlmUsage).where(LlmUsage.job_id == job_id).order_by(LlmUsage.created_at, LlmUsage.id)))
