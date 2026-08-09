import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transcript, TranscriptSegment
from app.services.transcriber import TranscriptResult


def save_transcript(session: Session, job_id: uuid.UUID, result: TranscriptResult) -> Transcript:
    transcript = Transcript(
        job_id=job_id, language=result.language, full_text=result.full_text)
    transcript.segments = [
        TranscriptSegment(
            start_time=seg.start,
            end_time=seg.end,
            text=seg.text,
            sequence_no=index,
        )
        for index, seg in enumerate(result.segments)
    ]

    session.add(transcript)
    session.commit()
    session.refresh(transcript)
    return transcript


def find_by_job_id(session: Session, job_id: uuid.UUID) -> Transcript | None:
    return session.scalar(select(Transcript).where(Transcript.job_id == job_id))
