import json
import logging
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import httpx
import pytest
from huggingface_hub.errors import HfHubHTTPError, OverloadedError

from app.services import pipeline
from app.services.retry import RetryableMessageError, TERMINAL_FAILURE_LOST_MARKER


class _FakeRpcError(grpc.RpcError):
    """見 tests/test_retry.py 同名替身：只需要 isinstance(exc, grpc.RpcError) 成立跟 code()。"""

    def __init__(self, code: grpc.StatusCode):
        self._code = code

    def code(self) -> grpc.StatusCode:
        return self._code


class _FakeSegment:
    def __init__(self, start_time: float, end_time: float, text: str):
        self.start_time = start_time
        self.end_time = end_time
        self.text = text


def _response(status_code: int) -> httpx.Response:
    return httpx.Response(status_code=status_code, request=httpx.Request("POST", "https://example.invalid"))


def _job_body() -> tuple[str, bytes]:
    job_id = str(uuid.uuid4())
    return job_id, json.dumps({"jobId": job_id}).encode("utf-8")


def _transcript() -> SimpleNamespace:
    return SimpleNamespace(full_text="哈囉大家好", segments=[_FakeSegment(0.0, 5.0, "哈囉大家好")])


@pytest.fixture
def mocks():
    """套上跟 tests/test_pipeline.py smoke test 相同的 mocking boundary（patch 在 pipeline 模組
    「使用端」import 進來的名稱），並預先設好 happy-path 的回傳值，測試再各自覆蓋要注入失敗的那個 mock。
    """
    mock_session = MagicMock(name="session")
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "summarize") as summarize,
        patch.object(pipeline, "generate_chapters") as generate_chapters,
        patch.object(pipeline, "embed_documents") as embed_documents,
        patch.object(pipeline, "new_session", return_value=mock_session),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = _transcript()
        summarize.return_value = "摘要"
        generate_chapters.return_value = []
        embed_documents.return_value = [[0.1, 0.2]]
        yield SimpleNamespace(
            job_status_client=job_status_client,
            transcript_client=transcript_client,
            summarize=summarize,
            generate_chapters=generate_chapters,
            embed_documents=embed_documents,
        )


# --- HF 呼叫點（摘要/章節分段/embedding 都走同一個 provider）：可重試例外 vs 永久性例外 vs
# 預算用盡（原始 spec 是 ai-service-groq-hf-retry，寫的當下摘要/章節分段還在用 Groq，
# 現在全部改走 HF，spec 名稱維持不變只是歷史記錄）---


def test_transient_hf_error_in_summarize_within_budget_raises_retryable(mocks):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("rate limited", response=_response(429))
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    mocks.job_status_client.update_status.assert_called_once_with(job_id, "SUMMARIZING")
    publish_failed.assert_not_called()
    publish_completed.assert_not_called()


def test_transient_hf_error_in_summarize_budget_exhausted_falls_back_to_failed(mocks):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("rate limited", response=_response(429))
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=2)

    mocks.job_status_client.update_status.assert_any_call(job_id, "FAILED", error_reason="rate limited")
    publish_failed.assert_called_once_with(job_id, "SUMMARIZING", "rate limited")
    publish_completed.assert_not_called()


def test_permanent_hf_error_in_summarize_falls_back_to_failed_regardless_of_budget(mocks):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("malformed request", response=_response(400))
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_called_once_with(job_id, "SUMMARIZING", "malformed request")
    publish_completed.assert_not_called()


def test_transient_hf_error_in_generate_chapters_raises_retryable(mocks):
    _, body = _job_body()
    mocks.generate_chapters.side_effect = HfHubHTTPError("rate limited", response=_response(429))
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_not_called()


def test_transient_hf_error_in_embed_documents_raises_retryable(mocks):
    _, body = _job_body()
    mocks.embed_documents.side_effect = OverloadedError("overloaded")
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=1)

    publish_failed.assert_not_called()


# --- 內部 gRPC 呼叫點：transcript-fetch / 中途狀態回報（ai-service-grpc-resilience）---


def test_transient_grpc_error_fetching_transcript_raises_retryable(mocks):
    _, body = _job_body()
    mocks.transcript_client.get_transcript.side_effect = _FakeRpcError(grpc.StatusCode.UNAVAILABLE)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_not_called()


def test_permanent_grpc_error_fetching_transcript_falls_back_to_failed(mocks):
    job_id, body = _job_body()
    mocks.transcript_client.get_transcript.side_effect = _FakeRpcError(grpc.StatusCode.NOT_FOUND)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_called_once()
    assert publish_failed.call_args.args[0] == job_id


def test_transient_grpc_error_marking_in_progress_raises_retryable(mocks):
    _, body = _job_body()
    mocks.job_status_client.update_status.side_effect = _FakeRpcError(grpc.StatusCode.DEADLINE_EXCEEDED)
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_not_called()


def test_transient_grpc_error_marking_completed_raises_retryable(mocks):
    _, body = _job_body()
    mocks.job_status_client.update_status.side_effect = [
        None,  # update_status(SUMMARIZING) 成功
        _FakeRpcError(grpc.StatusCode.RESOURCE_EXHAUSTED),  # update_status(COMPLETED) 暫時性失敗
    ]
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with pytest.raises(RetryableMessageError):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_completed.assert_not_called()
    publish_failed.assert_not_called()


# --- 終端失敗回報自己的獨立重試（ai-service-grpc-resilience issue 01）---


def test_terminal_report_retries_transient_failures_then_succeeds(mocks):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("malformed", response=_response(400))

    failed_attempts = {"n": 0}

    def fake_update_status(job_id_arg, status, error_reason=""):
        if status == "FAILED":
            failed_attempts["n"] += 1
            if failed_attempts["n"] < 3:
                raise _FakeRpcError(grpc.StatusCode.UNAVAILABLE)

    mocks.job_status_client.update_status.side_effect = fake_update_status
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with patch("app.services.retry.time.sleep"):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    assert failed_attempts["n"] == 3
    publish_failed.assert_called_once_with(job_id, "SUMMARIZING", "malformed")


def test_terminal_report_exhausted_logs_marker_and_does_not_publish_failed(mocks, caplog):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("malformed", response=_response(400))

    def fake_update_status(job_id_arg, status, error_reason=""):
        if status == "FAILED":
            raise _FakeRpcError(grpc.StatusCode.UNAVAILABLE)

    mocks.job_status_client.update_status.side_effect = fake_update_status
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with patch("app.services.retry.time.sleep"), caplog.at_level(logging.ERROR):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    publish_failed.assert_not_called()
    assert TERMINAL_FAILURE_LOST_MARKER in caplog.text
    assert job_id in caplog.text


def test_terminal_report_gives_up_immediately_on_permanent_failure_of_report_itself(mocks, caplog):
    job_id, body = _job_body()
    mocks.summarize.side_effect = HfHubHTTPError("malformed", response=_response(400))

    report_attempts = {"n": 0}

    def fake_update_status(job_id_arg, status, error_reason=""):
        if status == "FAILED":
            report_attempts["n"] += 1
            raise _FakeRpcError(grpc.StatusCode.NOT_FOUND)

    mocks.job_status_client.update_status.side_effect = fake_update_status
    publish_completed, publish_failed = MagicMock(), MagicMock()

    with patch("app.services.retry.time.sleep") as mock_sleep, caplog.at_level(logging.ERROR):
        pipeline.process_message(body, publish_completed, publish_failed, retry_count=0)

    assert report_attempts["n"] == 1
    mock_sleep.assert_not_called()
    publish_failed.assert_not_called()
    assert TERMINAL_FAILURE_LOST_MARKER in caplog.text
