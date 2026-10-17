import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import new_session
from app.models import SpeakerSuggestion


@dataclass(frozen=True)
class SpeakerSuggestionRecord:
    speaker_label: str
    name: str
    evidence_start_time: float
    evidence_text: str


def save_speaker_suggestions(job_id: uuid.UUID, records: list[SpeakerSuggestionRecord]) -> None:
    """換掉這個 Job 的建議（pipeline 對同一則訊息重跑時不會重複），全部是 pending。用自己的 session：pipeline 的 session 只存摘要、
    章節、embedding。"""
    session = new_session()
    try:
        session.execute(delete(SpeakerSuggestion).where(SpeakerSuggestion.job_id == job_id))
        session.add_all(SpeakerSuggestion(job_id=job_id, speaker_label=r.speaker_label, name=r.name,
                                          evidence_start_time=r.evidence_start_time, evidence_text=r.evidence_text,
                                          status="pending", position=position)
                        for position, r in enumerate(records))
        session.commit()
    finally:
        session.close()


def list_speaker_suggestions(session: Session, job_id: uuid.UUID) -> list[SpeakerSuggestion]:
    return list(session.scalars(
        select(SpeakerSuggestion).where(SpeakerSuggestion.job_id == job_id)
        .order_by(SpeakerSuggestion.position)))


def set_speaker_suggestion_status(session: Session, job_id: uuid.UUID, speaker_label: str,
                                  status: str) -> SpeakerSuggestion | None:
    suggestion = session.scalar(select(SpeakerSuggestion).where(
        SpeakerSuggestion.job_id == job_id, SpeakerSuggestion.speaker_label == speaker_label))
    if suggestion is None:
        return None
    suggestion.status = status
    session.commit()
    return suggestion
