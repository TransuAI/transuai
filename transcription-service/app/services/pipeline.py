import json
import logging
import uuid
from pathlib import Path
from typing import Callable

from app.db import new_session
from app.repositories.transcript_repository import save_transcript
from app.services.audio import extract_audio_track
from app.services.job_status_client import job_status_client
from app.services.storage import download_object
from app.services.transcriber import transcribe

logger = logging.getLogger(__name__)


def process_message(body: bytes, publish_completed: Callable[[str], None]) -> None:
    """處理一則 transcription.requested 訊息：抽音軌 -> 轉錄 -> 存逐字稿 -> 回寫狀態 -> 發 transcription.completed。

    任何一步失敗都回寫 Job status=FAILED 並記錄 error_reason，不把例外往外拋——
    讓 consumer 正常 ack 這則訊息，避免永久性失敗（例如壞檔、額度用盡）造成無窮 requeue。
    """
    payload = json.loads(body)
    job_id: str = payload["jobId"]
    storage_path: str = payload["storagePath"]
    file_type: str = payload["fileType"]

    logger.info("processing job %s (%s) storage_path=%s",
                job_id, file_type, storage_path)

    downloaded: Path | None = None
    audio_path: Path | None = None
    try:
        job_status_client.update_status(job_id, "TRANSCRIBING")

        downloaded = download_object(storage_path)
        audio_path = extract_audio_track(
            downloaded) if file_type == "VIDEO" else downloaded

        result = transcribe(audio_path)

        session = new_session()
        try:
            save_transcript(session, uuid.UUID(job_id), result)
        finally:
            session.close()

        job_status_client.update_status(job_id, "TRANSCRIBED")
        publish_completed(job_id)
        logger.info("job %s transcribed successfully", job_id)
    except Exception as exc:
        logger.exception("job %s failed", job_id)
        job_status_client.update_status(
            job_id, "FAILED", error_reason=str(exc)[:500])
    finally:
        if downloaded is not None:
            downloaded.unlink(missing_ok=True)
        if audio_path is not None and audio_path != downloaded:
            audio_path.unlink(missing_ok=True)
