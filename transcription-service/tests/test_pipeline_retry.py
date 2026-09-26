import json
import uuid
from unittest.mock import MagicMock

import httpx
import pytest

from app.services import pipeline
from app.services.retry import RetryableMessageError


def _http_error(status_code: int, message: str) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.deepgram.com/v1/listen")
    return httpx.HTTPStatusError(message, request=request, response=httpx.Response(status_code, request=request))


def _job_body() -> tuple[str, bytes]:
    job_id = str(uuid.uuid4())
    body = json.dumps(
        {"jobId": job_id, "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}).encode("utf-8")
    return job_id, body


@pytest.mark.parametrize("error", [
    _http_error(429, "rate limited"),
    _http_error(503, "overloaded"),
    httpx.ReadTimeout("timed out"),
    httpx.ConnectError("connection refused"),
])
def test_transient_recognition_error_within_budget_raises_retryable(mocks, error):
    job_id, body = _job_body()
    mocks.recognize.side_effect = error
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    mocks.job_status_client.update_status.assert_called_once_with(job_id, "TRANSCRIBING")
    publish_failed.assert_not_called()
    publish_completed.assert_not_called()


def test_transient_recognition_error_budget_exhausted_falls_back_to_failed(mocks):
    job_id, body = _job_body()
    mocks.recognize.side_effect = _http_error(429, "rate limited")
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=2)

    mocks.job_status_client.update_status.assert_any_call(job_id, "FAILED", error_reason="rate limited")
    publish_failed.assert_called_once_with(job_id, "TRANSCRIBING", "rate limited")
    publish_completed.assert_not_called()


def test_permanent_recognition_error_falls_back_to_failed_regardless_of_budget(mocks):
    job_id, body = _job_body()
    mocks.recognize.side_effect = _http_error(400, "malformed")
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_called_once_with(job_id, "TRANSCRIBING", "malformed")
    publish_completed.assert_not_called()


def test_other_exception_falls_back_to_failed_unchanged(mocks):
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
