"""錄音長度在送去語音辨識之前用實際長度檢查（.scratch/pre-launch-hardening/issues/17，ASVS 11.1.5）：上傳時的長度是前端量的、可以亂填。
超過每個檔案的上限、或超過這個月剩下的轉錄分鐘數，就不呼叫語音辨識，Job 失敗並說原因。"""

import json
import subprocess
import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import imageio_ffmpeg
import pytest

from app.repositories.transcription_usage_repository import TranscriptionUsageRecord, save_transcription_usage
from app.services import pipeline, recording_limits, transcription_usage
from app.services.audio import media_duration_seconds

OWNER = uuid.UUID("00000000-0000-0000-0000-0000000000b2")


def run(mocks, *, file_type="AUDIO", user_id: uuid.UUID | None = OWNER):
    job_id = str(uuid.uuid4())
    payload = {"jobId": job_id, "storagePath": "uploads/a.mp3", "fileType": file_type}
    if user_id:
        payload["userId"] = str(user_id)
    publish_failed = MagicMock()
    with patch.object(transcription_usage, "save_transcription_usage") as saved_usage:
        pipeline.process_message(json.dumps(payload).encode(), MagicMock(), publish_failed)
    return job_id, publish_failed, saved_usage


def failure_reason(mocks, job_id):
    calls = [c for c in mocks.job_status_client.update_status.call_args_list if c.args == (job_id, "FAILED")]
    assert len(calls) == 1
    return calls[0].kwargs["error_reason"]


def test_a_recording_longer_than_an_hour_is_not_transcribed(mocks):
    mocks.media_duration_seconds.return_value = 61 * 60.05  # ffmpeg often reads a little over

    job_id, publish_failed, saved_usage = run(mocks)

    mocks.recognize.assert_not_called()
    saved_usage.assert_not_called()  # nothing was sent, so nothing was used
    assert failure_reason(mocks, job_id) == "錄音長 61 分鐘，超過每個檔案 60 分鐘的上限，沒有轉錄"
    publish_failed.assert_called_once()


def test_a_video_too_long_is_refused_before_its_audio_track_is_extracted(mocks):
    mocks.media_duration_seconds.return_value = 2 * 3600.0

    job_id, _, _ = run(mocks, file_type="VIDEO")

    mocks.extract_audio_track.assert_not_called()
    assert "超過每個檔案 60 分鐘的上限" in failure_reason(mocks, job_id)


def test_a_recording_that_does_not_fit_in_what_is_left_this_month_is_not_transcribed(mocks):
    mocks.used_this_month.return_value = 590 * 60.0
    mocks.media_duration_seconds.return_value = 20 * 60.0

    job_id, _, _ = run(mocks)

    mocks.recognize.assert_not_called()
    mocks.used_this_month.assert_called_once_with(OWNER)
    assert failure_reason(mocks, job_id) == (
        "這個月的轉錄只剩 10 分鐘（用量上限 600 分鐘），這個錄音 20 分鐘，沒有轉錄；下個月 1 日恢復")


def test_a_recording_that_fits_is_transcribed(mocks):
    mocks.used_this_month.return_value = 590 * 60.0
    mocks.media_duration_seconds.return_value = 9 * 60.0

    job_id, publish_failed, _ = run(mocks)

    mocks.recognize.assert_called_once()
    mocks.job_status_client.update_status.assert_any_call(job_id, "TRANSCRIBED")
    publish_failed.assert_not_called()


def test_a_recording_whose_length_cannot_be_read_is_not_transcribed(mocks):
    mocks.media_duration_seconds.return_value = None

    job_id, _, _ = run(mocks)

    mocks.recognize.assert_not_called()
    assert failure_reason(mocks, job_id) == "無法判斷錄音的長度，沒有轉錄"


def test_a_message_without_an_owner_only_has_the_length_checked(mocks):
    run(mocks, user_id=None)

    mocks.used_this_month.assert_not_called()
    mocks.recognize.assert_called_once()


# --- 這個月已經用了多少（真的 Postgres）---

def transcribed(at, seconds, *, user_id=OWNER):
    return TranscriptionUsageRecord(user_id=user_id, job_id=uuid.uuid4(), provider="deepgram", model="nova-3",
                                    audio_seconds=seconds, succeeded=True, created_at=at)


def test_this_months_use_counts_only_this_month_in_taiwan_time_and_only_this_user(db_session):
    now = datetime.now(ZoneInfo("Asia/Taipei"))
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    save_transcription_usage(transcribed(now, 90.0))
    save_transcription_usage(transcribed(month_start + timedelta(seconds=1), 30.0))
    save_transcription_usage(transcribed(month_start - timedelta(seconds=1), 1000.0))  # last month
    save_transcription_usage(transcribed(now, 500.0, user_id=uuid.uuid4()))  # someone else

    assert recording_limits._used_this_month(OWNER) == pytest.approx(120.0)


# --- 讀長度（真的 ffmpeg）---

def test_the_length_of_a_recording_is_read_from_the_file(tmp_path):
    path = tmp_path / "tone.mp3"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "lavfi",
                    "-i", "sine=frequency=440:duration=3", str(path)], check=True)

    assert media_duration_seconds(path) == pytest.approx(3.0, abs=0.1)


def test_a_file_that_is_not_media_has_no_length(tmp_path):
    path = tmp_path / "page.mp3"
    path.write_text("<script>alert(1)</script>")

    assert media_duration_seconds(path) is None
