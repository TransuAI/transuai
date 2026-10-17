import logging
import uuid

from app.repositories.transcription_usage_repository import TranscriptionUsageRecord, save_transcription_usage
from app.services.speech_recognition import model_name, provider

logger = logging.getLogger(__name__)


def record_transcription_usage(
    user_id: uuid.UUID | None, job_id: uuid.UUID, audio_seconds: float | None, *, succeeded: bool
) -> None:
    """記一筆轉錄用量（廠商與模型由語音辨識 adapter 提供）。存不進去只記 log：少一筆紀錄比整個 Job 失敗好。"""
    try:
        save_transcription_usage(TranscriptionUsageRecord(
            user_id=user_id, job_id=job_id, provider=provider(), model=model_name(),
            audio_seconds=audio_seconds, succeeded=succeeded,
        ))
    except Exception:
        logger.exception("could not record transcription usage for job %s", job_id)
