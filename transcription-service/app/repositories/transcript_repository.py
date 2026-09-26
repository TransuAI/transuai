import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Speaker, Transcript, TranscriptSegment
from app.services.transcript_result import TranscriptResult


def save_transcript(session: Session, job_id: uuid.UUID, result: TranscriptResult) -> Transcript:
    transcript = Transcript(
        job_id=job_id, language=result.language, full_text=result.full_text)
    transcript.segments = [
        TranscriptSegment(
            start_time=seg.start,
            end_time=seg.end,
            speaker_label=seg.speaker_label,
            text=seg.text,
            original_text=seg.text,
            sequence_no=index,
        )
        for index, seg in enumerate(result.segments)
    ]
    transcript.speakers = [
        Speaker(label=label, display_order=order) for order, label in enumerate(result.speaker_labels, start=1)]

    session.add(transcript)
    session.commit()
    session.refresh(transcript)
    return transcript


def find_by_job_id(session: Session, job_id: uuid.UUID) -> Transcript | None:
    return session.scalar(select(Transcript).where(Transcript.job_id == job_id))


class SegmentNotFound(Exception):
    """這個 job 沒有逐字稿，或片段不屬於它的逐字稿。"""


@dataclass
class SegmentEdit:
    segment: TranscriptSegment
    revision: int  # 逐字稿目前的 revision
    changed: bool  # False＝文字跟原本一樣，什麼都沒做


def update_segment_text(session: Session, job_id: uuid.UUID, segment_id: uuid.UUID, text: str) -> SegmentEdit:
    """編輯一個片段的文字（text 已由呼叫端正規化，空字串＝清空）。文字沒變時什麼都不做；否則
    revision +1、以未清空片段依換行重組 full_text。同時兩個編輯是「最後寫入為準」。"""
    transcript = _lock_transcript(session, job_id)
    segment = next((s for s in transcript.segments if s.id == segment_id), None) if transcript else None
    if transcript is None or segment is None:
        session.rollback()
        raise SegmentNotFound()

    if segment.text == text:
        session.rollback()
        return SegmentEdit(segment, transcript.revision, changed=False)

    segment.text = text
    transcript.revision += 1
    transcript.full_text = "\n".join(s.text for s in transcript.segments if s.text != "")
    session.commit()
    return SegmentEdit(segment, transcript.revision, changed=True)


def _lock_transcript(session: Session, job_id: uuid.UUID) -> Transcript | None:
    # 逐字稿那一列用 SELECT ... FOR UPDATE 鎖住：同一份逐字稿的編輯一個一個來，revision 才會各加一次。
    return session.scalar(select(Transcript).where(Transcript.job_id == job_id).with_for_update())


class SpeakerNotFound(Exception):
    """這個 job 沒有逐字稿，或它的逐字稿沒有這個標籤的講者。"""


@dataclass
class SpeakerEdit:
    speaker: Speaker
    revision: int  # 逐字稿目前的 revision
    changed: bool  # False＝顯示名稱跟原本一樣，什麼都沒做


def rename_speaker(session: Session, job_id: uuid.UUID, label: str, name: str | None) -> SpeakerEdit:
    """替講者命名（name 已由呼叫端正規化，None＝恢復預設名稱）。等於預設名稱「講者 N」也當成恢復預設；
    顯示名稱沒變時什麼都不做，否則 revision +1。"""
    transcript = _lock_transcript(session, job_id)
    speaker = next((s for s in transcript.speakers if s.label == label), None) if transcript else None
    if transcript is None or speaker is None:
        session.rollback()
        raise SpeakerNotFound()

    if name == speaker.default_name:
        name = None
    if speaker.name == name:
        session.rollback()
        return SpeakerEdit(speaker, transcript.revision, changed=False)

    speaker.name = name
    transcript.revision += 1
    session.commit()
    return SpeakerEdit(speaker, transcript.revision, changed=True)
