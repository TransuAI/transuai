import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Summary


def save_summary(session: Session, job_id: uuid.UUID, summary_text: str) -> Summary:
    summary = Summary(job_id=job_id, summary_text=summary_text)
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary


def find_by_job_id(session: Session, job_id: uuid.UUID) -> Summary | None:
    return session.scalar(select(Summary).where(Summary.job_id == job_id))
