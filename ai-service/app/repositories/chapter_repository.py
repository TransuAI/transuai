import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Chapter


def save_chapters(session: Session, job_id: uuid.UUID, chapters: list[tuple[str, float]]) -> list[Chapter]:
    """覆蓋寫入某個 job 的章節列表：先刪除舊資料（重新處理時避免留下前一次的章節），
    再依 chapters 的順序寫入、指定 sequence_no。"""
    session.query(Chapter).filter(Chapter.job_id == job_id).delete()
    rows = [
        Chapter(job_id=job_id, title=title, start_time=start_time, sequence_no=sequence_no)
        for sequence_no, (title, start_time) in enumerate(chapters)
    ]
    session.add_all(rows)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


def find_by_job_id(session: Session, job_id: uuid.UUID) -> list[Chapter]:
    return list(
        session.scalars(
            select(Chapter).where(Chapter.job_id ==
                                   job_id).order_by(Chapter.sequence_no)
        )
    )
