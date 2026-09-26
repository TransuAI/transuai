import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import QaHistory


def find_by_job_id(session: Session, job_id: uuid.UUID) -> list[QaHistory]:
    """依 created_at 升冪回傳這個 job 的完整問答紀錄，沒有紀錄回空列表。

    「對話」的範圍就是整個 job——沒有獨立的 conversation/thread 概念，見
    ai-service/docs/adr/ 對話範圍的 ADR。呼叫端可以自行決定要顯示全部（歷史列表用）
    還是只取最後幾筆當作對話記憶（回答問題用）。
    """
    return list(
        session.scalars(
            select(QaHistory).where(QaHistory.job_id == job_id).order_by(QaHistory.created_at.asc())
        )
    )


def save_qa(
    session: Session,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    question: str,
    answer: str,
    source_timestamps: list[float],
    *,
    model: tuple[str, str],
) -> QaHistory:
    qa = QaHistory(
        job_id=job_id,
        user_id=user_id,
        question=question,
        answer=answer,
        model_provider=model[0],
        model=model[1],
        source_timestamps=source_timestamps,
    )
    session.add(qa)
    session.commit()
    session.refresh(qa)
    return qa
