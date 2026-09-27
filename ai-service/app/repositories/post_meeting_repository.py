import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import ActionProposal, PostMeetingRun, PostMeetingStatus


def latest_run(session: Session, job_id: uuid.UUID) -> PostMeetingRun | None:
    return session.scalar(select(PostMeetingRun).where(PostMeetingRun.job_id == job_id)
                          .order_by(PostMeetingRun.requested_at.desc(), PostMeetingRun.id).limit(1))


def list_proposals(session: Session, run_id: uuid.UUID) -> list[ActionProposal]:
    return list(session.scalars(select(ActionProposal).where(ActionProposal.run_id == run_id)
                                .order_by(ActionProposal.position)))


def set_progress(session: Session, run_id: uuid.UUID, progress: str) -> None:
    run = session.get(PostMeetingRun, run_id)
    if run is not None:
        run.progress = progress
        session.commit()


def record_model(session: Session, run_id: uuid.UUID, provider: str, model: str) -> None:
    run = session.get(PostMeetingRun, run_id)
    if run is not None:
        run.model_provider, run.model = provider, model
        session.commit()


def add_proposal(session: Session, run_id: uuid.UUID, service: str, tool: str, kind: str, arguments: dict) -> None:
    position = session.scalar(select(func.count()).where(ActionProposal.run_id == run_id)) or 0
    session.add(ActionProposal(run_id=run_id, position=position + 1, service=service, tool=tool, kind=kind,
                               arguments=arguments))
    session.commit()


def restart_run(session: Session, run_id: uuid.UUID, progress: str, *, started_at: datetime | None) -> None:
    """（重新）開始跑：清掉上一次留下的提案，從頭來過。started_at 是這一次開始的時間（卡住從這裡算）；排隊等重試時是空的。"""
    session.execute(delete(ActionProposal).where(ActionProposal.run_id == run_id))
    run = session.get(PostMeetingRun, run_id)
    if run is not None:
        run.progress = progress
        run.started_at = started_at
    session.commit()


def finish_run(session: Session, run_id: uuid.UUID, status: PostMeetingStatus, *, finished_at: datetime,
               failure_reason: str | None = None) -> None:
    run = session.get(PostMeetingRun, run_id, with_for_update=True)
    if run is None or run.status != PostMeetingStatus.RUNNING:
        session.rollback()
        return
    run.status = status
    run.failure_reason = failure_reason
    run.progress = ""
    run.finished_at = finished_at
    session.commit()
