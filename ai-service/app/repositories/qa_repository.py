import uuid

from sqlalchemy.orm import Session

from app.models import QaHistory


def save_qa(
    session: Session,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    source_timestamps: list[float],
) -> QaHistory:
    qa = QaHistory(
        job_id=job_id,
        user_id=user_id,
        question=question,
        answer=answer,
        source_timestamps=source_timestamps,
    )
    session.add(qa)
    session.commit()
    session.refresh(qa)
    return qa
