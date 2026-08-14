import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Summary


def save_summary(session: Session, job_id: uuid.UUID, summary_text: str) -> Summary:
    """覆蓋寫入某個 job 的摘要：先刪除舊資料再寫入新的一筆，跟 chapter_repository /
    embedding_repository 用同一個模式——訊息層級的重試會讓整個 pipeline 重跑，若不先刪除舊資料，
    第二次寫入會撞上 `job_id` 的 unique 約束。"""
    session.query(Summary).filter(Summary.job_id == job_id).delete()
    summary = Summary(job_id=job_id, summary_text=summary_text)
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary


def find_by_job_id(session: Session, job_id: uuid.UUID) -> Summary | None:
    return session.scalar(select(Summary).where(Summary.job_id == job_id))
