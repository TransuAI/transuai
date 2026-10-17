import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RegenerationStatus, Summary
from app.repositories.chapter_repository import replace_chapters


def save_summary(
    session: Session, job_id: uuid.UUID, summary_text: str, *, source_revision: int, model: tuple[str, str]
) -> Summary:
    """覆蓋寫入某個 job 的摘要：先刪除舊資料再寫入新的一筆，跟 chapter_repository /
    embedding_repository 用同一個模式——訊息層級的重試會讓整個 pipeline 重跑，若不先刪除舊資料，
    第二次寫入會撞上 `job_id` 的 unique 約束。"""
    session.query(Summary).filter(Summary.job_id == job_id).delete()
    summary = Summary(job_id=job_id, summary_text=summary_text, source_revision=source_revision,
                      model_provider=model[0], model=model[1])
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return summary


def find_by_job_id(session: Session, job_id: uuid.UUID) -> Summary | None:
    return session.scalar(select(Summary).where(Summary.job_id == job_id))


def lock_summary(session: Session, job_id: uuid.UUID) -> Summary | None:
    """讀取並鎖住（SELECT … FOR UPDATE）某個 job 的摘要列，直到這個 transaction 結束。"""
    return session.scalar(select(Summary).where(Summary.job_id == job_id).with_for_update())


def replace_summary_and_chapters(
    session: Session,
    job_id: uuid.UUID,
    summary_text: str,
    chapters: list[tuple[str, float]],
    *,
    source_revision: int,
    model: tuple[str, str],
) -> None:
    """重新產生的結果：在「原本那一列」上更新摘要（不刪掉重建，所以同時進來的 RequestRegeneration
    的 row lock 仍然有效）、換掉章節，並把重新產生狀態回到 IDLE——全部在同一個 transaction 裡，輪詢
    不會看到新摘要配舊章節，寫章節失敗時摘要也不會被換掉。"""
    summary = lock_summary(session, job_id)
    if summary is None:
        summary = Summary(job_id=job_id)
        session.add(summary)
    summary.summary_text = summary_text
    summary.source_revision = source_revision
    summary.model_provider, summary.model = model
    summary.regeneration_status = RegenerationStatus.IDLE
    summary.regeneration_requested_at = None
    replace_chapters(session, job_id, chapters)
    session.commit()


def mark_regeneration_failed(session: Session, job_id: uuid.UUID) -> None:
    summary = lock_summary(session, job_id)
    if summary is not None:
        summary.regeneration_status = RegenerationStatus.FAILED
    session.commit()

