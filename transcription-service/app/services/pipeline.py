import json
import logging
import uuid
from pathlib import Path
from typing import Callable

from app.db import new_session
from app.repositories.transcript_repository import save_transcript
from app.services.audio import extract_audio_track
from app.services.job_status_client import job_status_client
from app.services.retry import RetryableMessageError, retry_queue_for
from app.services.segmentation import build_transcript
from app.services.speech_recognition import is_transient_recognition_error, recognize
from app.services.storage import download_object
from app.services.traditional_chinese import to_traditional_if_chinese
from app.services.transcription_usage import record_transcription_usage

logger = logging.getLogger(__name__)


def _job_owner(payload: dict) -> uuid.UUID | None:
    """訊息裡的 Job 擁有者（`userId`）；舊訊息沒有、或格式不對時當成不知道，不值得讓整則訊息失敗。"""
    try:
        return uuid.UUID(payload["userId"]) if payload.get("userId") else None
    except ValueError:
        logger.warning("ignoring malformed userId %r in message for job %s", payload.get("userId"), payload.get("jobId"))
        return None


def process_message(
    body: bytes,
    publish_completed: Callable[[str, str | None], None],
    publish_failed: Callable[[str, str, str], None],
    retry_count: int = 0,
) -> None:
    """處理一則 transcription.requested 訊息：抽音軌 -> 語音辨識（含講者分離）-> 切片段 -> 中文轉繁體 -> 存逐字稿
    -> 回寫狀態 -> 發 transcription.completed。

    `retry_count` 是這則訊息目前已經被重新投遞過幾次（由 consumer.py 從訊息 header 讀出、傳進來），
    第一次送達永遠是 0。`recognize()` 遇到暫時性錯誤（429、5xx、逾時，見 app/services/speech_recognition.py）
    且還沒到重試預算上限時，raise RetryableMessageError，交給 consumer.py 決定送去哪條 retry queue，
    不落入下面的 FAILED 路徑。

    其他情況（永久性失敗，例如壞檔；或暫時性失敗但預算已用盡；或 download/extract_audio/DB 等步驟
    的例外，目前還不在這個重試機制涵蓋範圍內）都維持現狀回寫 Job status=FAILED 並記錄 error_reason、
    發送 job.failed，不把例外往外拋——讓 consumer 正常 ack 這則訊息，避免無窮 requeue。
    """
    payload = json.loads(body)
    job_id: str = payload["jobId"]
    storage_path: str = payload["storagePath"]
    file_type: str = payload["fileType"]
    # Job 擁有者：轉錄用量記在他名下，也往下傳給 ai-service；升級當下還在佇列裡的舊訊息沒有。
    owner = _job_owner(payload)
    # 上傳時選的轉錄語言（見 docs/adr/0002）；舊訊息沒有，recognize() 用設定的預設（中文）。
    language: str | None = payload.get("transcriptionLanguage")

    logger.info("processing job %s (%s) storage_path=%s",
                job_id, file_type, storage_path)

    downloaded: Path | None = None
    audio_path: Path | None = None
    try:
        job_status_client.update_status(job_id, "TRANSCRIBING")

        downloaded = download_object(storage_path)
        audio_path = extract_audio_track(
            downloaded) if file_type == "VIDEO" else downloaded

        try:
            recognition = recognize(audio_path, language)
        except Exception:
            record_transcription_usage(owner, uuid.UUID(job_id), None, succeeded=False)
            raise
        record_transcription_usage(owner, uuid.UUID(job_id), recognition.audio_seconds, succeeded=True)
        result = to_traditional_if_chinese(build_transcript(recognition))

        session = new_session()
        try:
            save_transcript(session, uuid.UUID(job_id), result)
        finally:
            session.close()

        job_status_client.update_status(job_id, "TRANSCRIBED")
        publish_completed(job_id, str(owner) if owner else None)
        logger.info("job %s transcribed successfully", job_id)
    except Exception as exc:
        if is_transient_recognition_error(exc) and retry_queue_for(retry_count) is not None:
            raise RetryableMessageError(
                f"job {job_id}: transient failure, retry_count={retry_count}") from exc

        logger.exception("job %s failed", job_id)
        error_reason = str(exc)[:500]
        try:
            job_status_client.update_status(
                job_id, "FAILED", error_reason=error_reason)
            publish_failed(job_id, "TRANSCRIBING", error_reason)
        except Exception:
            # 回報失敗本身也失敗了（例如 job 在 upload-service 那邊已經不存在）。
            # 這裡一定要接住，不能讓例外繼續往外冒——冒出去會直接把 consumer thread 弄死，
            # 之後整個 process 都不會再消費新訊息（需要重啟才會恢復），比漏掉這一則訊息嚴重得多。
            logger.exception(
                "job %s: also failed to report FAILED status / publish job.failed, giving up on this message", job_id)
    finally:
        if downloaded is not None:
            downloaded.unlink(missing_ok=True)
        if audio_path is not None and audio_path != downloaded:
            audio_path.unlink(missing_ok=True)
