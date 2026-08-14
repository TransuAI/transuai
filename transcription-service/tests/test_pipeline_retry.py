import json
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest
from groq import BadRequestError, RateLimitError

from app.services import pipeline
from app.services.retry import RetryableMessageError


def _response(status_code: int) -> httpx.Response:
    return httpx.Response(status_code=status_code, request=httpx.Request("POST", "https://example.invalid"))


def _job_body() -> tuple[str, bytes]:
    job_id = str(uuid.uuid4())
    body = json.dumps(
        {"jobId": job_id, "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}).encode("utf-8")
    return job_id, body


@pytest.fixture
def mocks():
    """套上跟 ai-service/tests/test_pipeline_retry.py 同一種 mocking boundary（patch 在 pipeline
    模組「使用端」import 進來的名稱），並預先設好 happy-path 的回傳值。"""
    mock_session = MagicMock(name="session")
    fake_downloaded = Path("/tmp/fake-download.mp3")
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "download_object", return_value=fake_downloaded) as download_object,
        patch.object(pipeline, "extract_audio_track") as extract_audio_track,
        patch.object(pipeline, "transcribe") as transcribe,
        patch.object(pipeline, "new_session", return_value=mock_session),
        patch.object(pipeline, "save_transcript"),
        patch("pathlib.Path.unlink"),
    ):
        transcribe.return_value = MagicMock(name="TranscriptResult")
        yield type(
            "Mocks",
            (),
            {
                "job_status_client": job_status_client,
                "download_object": download_object,
                "extract_audio_track": extract_audio_track,
                "transcribe": transcribe,
            },
        )


def test_transient_groq_error_in_transcribe_within_budget_raises_retryable(mocks):
    job_id, body = _job_body()
    mocks.transcribe.side_effect = RateLimitError("rate limited", response=_response(429), body=None)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    mocks.job_status_client.update_status.assert_called_once_with(job_id, "TRANSCRIBING")
    publish_failed.assert_not_called()
    publish_completed.assert_not_called()


def test_transient_groq_error_in_transcribe_budget_exhausted_falls_back_to_failed(mocks):
    job_id, body = _job_body()
    mocks.transcribe.side_effect = RateLimitError("rate limited", response=_response(429), body=None)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=2)

    mocks.job_status_client.update_status.assert_any_call(job_id, "FAILED", error_reason="rate limited")
    publish_failed.assert_called_once_with(job_id, "TRANSCRIBING", "rate limited")
    publish_completed.assert_not_called()


def test_permanent_groq_error_in_transcribe_falls_back_to_failed_regardless_of_budget(mocks):
    job_id, body = _job_body()
    mocks.transcribe.side_effect = BadRequestError("malformed", response=_response(400), body=None)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_called_once_with(job_id, "TRANSCRIBING", "malformed")
    publish_completed.assert_not_called()


def test_non_groq_exception_falls_back_to_failed_unchanged(mocks):
    job_id, body = _job_body()
    mocks.download_object.side_effect = OSError("storage unreachable")
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_called_once_with(job_id, "TRANSCRIBING", "storage unreachable")
    publish_completed.assert_not_called()


def test_happy_path_still_works_with_default_retry_count(mocks):
    job_id, body = _job_body()
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed)

    mocks.job_status_client.update_status.assert_any_call(job_id, "TRANSCRIBED")
    publish_completed.assert_called_once_with(job_id)
    publish_failed.assert_not_called()
