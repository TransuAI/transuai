import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import new_session
from app.models import WebSearchUsage


def save_web_search(user_id: uuid.UUID | None, job_id: uuid.UUID, provider: str, succeeded: bool) -> None:
    """用自己的 session 立即寫入：這一題後面失敗（例如回答串流中斷），查過的這一次照樣算。"""
    session = new_session()
    try:
        session.add(WebSearchUsage(user_id=user_id, job_id=job_id, provider=provider, succeeded=succeeded))
        session.commit()
    finally:
        session.close()


def list_job_web_searches(session: Session, job_id: uuid.UUID) -> list[WebSearchUsage]:
    return list(session.scalars(
        select(WebSearchUsage).where(WebSearchUsage.job_id == job_id)
        .order_by(WebSearchUsage.created_at, WebSearchUsage.id)))


def count_user_web_searches(session: Session, user_id: uuid.UUID, start: datetime, end: datetime) -> tuple[int, int]:
    """一位使用者在 [start, end) 之間的搜尋次數：（成功, 失敗）。"""
    succeeded, failed = session.execute(
        select(func.count().filter(WebSearchUsage.succeeded), func.count().filter(~WebSearchUsage.succeeded))
        .where(WebSearchUsage.user_id == user_id, WebSearchUsage.created_at >= start, WebSearchUsage.created_at < end)
    ).one()
    return succeeded, failed
