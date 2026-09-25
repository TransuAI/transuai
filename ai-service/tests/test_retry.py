from unittest.mock import call, patch

import grpc
import httpx
import pytest
from huggingface_hub.errors import HfHubHTTPError, InferenceTimeoutError, OverloadedError

from app.core.config import settings
from app.services import retry


class _FakeRpcError(grpc.RpcError):
    """grpc._channel._InactiveRpcError 的簡化替身：真正的型別需要 C extension 內部狀態，
    這裡只需要 isinstance(exc, grpc.RpcError) 成立、且 code() 回傳指定的 status code。"""

    def __init__(self, code: grpc.StatusCode):
        self._code = code

    def code(self) -> grpc.StatusCode:
        return self._code


def _httpx_request() -> httpx.Request:
    return httpx.Request("POST", "https://example.invalid")


def _httpx_response(status_code: int) -> httpx.Response:
    return httpx.Response(status_code=status_code, request=_httpx_request())


# --- retry queue 路由與宣告：純函式，不碰真正的 RabbitMQ/pika ---


def test_first_retry_routes_to_the_source_queues_2s_retry_queue():
    assert retry.retry_queue_for("transcription.completed", 0) == "transcription.completed.retry.2s"


def test_second_retry_routes_to_the_source_queues_4s_retry_queue():
    assert retry.retry_queue_for("transcription.completed", 1) == "transcription.completed.retry.4s"


@pytest.mark.parametrize("retry_count", [2, 3, 100])
def test_exhausted_retry_budget_has_no_retry_queue(retry_count):
    assert retry.retry_queue_for("transcription.completed", retry_count) is None
    assert not retry.has_retry_budget(retry_count)


@pytest.mark.parametrize("retry_count", [0, 1])
def test_retry_budget_remains_for_the_first_two_retries(retry_count):
    assert retry.has_retry_budget(retry_count)


def test_each_consumed_queue_gets_retry_queues_that_dead_letter_back_to_itself():
    declarations = retry.retry_queue_declarations("transcript.edited")

    assert declarations == [
        ("transcript.edited.retry.2s", {
            "x-message-ttl": 2000, "x-dead-letter-exchange": "", "x-dead-letter-routing-key": "transcript.edited"}),
        ("transcript.edited.retry.4s", {
            "x-message-ttl": 4000, "x-dead-letter-exchange": "", "x-dead-letter-routing-key": "transcript.edited"}),
    ]
    assert retry.retry_queue_for("transcript.edited", 1) == "transcript.edited.retry.4s"


def test_transcription_completed_keeps_its_existing_retry_queue_names():
    # Queues already declared on running RabbitMQ brokers keep working without manual cleanup.
    assert [name for name, _ in retry.retry_queue_declarations(settings.transcription_completed_queue)] == [
        "transcription.completed.retry.2s",
        "transcription.completed.retry.4s",
    ]


# --- HF 例外分類 ---


@pytest.mark.parametrize(
    "exc",
    [
        OverloadedError("overloaded"),
        InferenceTimeoutError("timed out"),
        HfHubHTTPError("rate limited", response=_httpx_response(429)),
        HfHubHTTPError("internal error", response=_httpx_response(500)),
        HfHubHTTPError("bad gateway", response=_httpx_response(502)),
        HfHubHTTPError("service unavailable", response=_httpx_response(503)),
        HfHubHTTPError("gateway timeout", response=_httpx_response(504)),
    ],
)
def test_is_retryable_hf_error_true_for_transient_types(exc):
    assert retry.is_retryable_hf_error(exc) is True


@pytest.mark.parametrize(
    "exc",
    [
        HfHubHTTPError("not found", response=_httpx_response(404)),
        HfHubHTTPError("bad request", response=_httpx_response(400)),
        ValueError("not an hf error"),
    ],
)
def test_is_retryable_hf_error_false_for_permanent_types(exc):
    assert retry.is_retryable_hf_error(exc) is False


# --- gRPC 例外分類 ---


@pytest.mark.parametrize(
    "code",
    [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED, grpc.StatusCode.RESOURCE_EXHAUSTED],
)
def test_is_retryable_grpc_error_true_for_transient_codes(code):
    assert retry.is_retryable_grpc_error(_FakeRpcError(code)) is True


@pytest.mark.parametrize(
    "code",
    [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.INVALID_ARGUMENT, grpc.StatusCode.UNKNOWN],
)
def test_is_retryable_grpc_error_false_for_permanent_codes(code):
    assert retry.is_retryable_grpc_error(_FakeRpcError(code)) is False


def test_is_retryable_grpc_error_false_for_non_rpc_exception():
    assert retry.is_retryable_grpc_error(ValueError("nope")) is False


# --- retry_terminal_report：獨立、快速的 in-process 重試 ---


def test_retry_terminal_report_succeeds_without_retry_when_report_succeeds():
    calls = []

    def report():
        calls.append(1)

    with patch.object(retry.time, "sleep") as mock_sleep:
        result = retry.retry_terminal_report(report)

    assert result is True
    assert len(calls) == 1
    mock_sleep.assert_not_called()


def test_retry_terminal_report_retries_transient_failures_then_succeeds():
    calls = []

    def report():
        calls.append(1)
        if len(calls) < 3:
            raise _FakeRpcError(grpc.StatusCode.UNAVAILABLE)

    with patch.object(retry.time, "sleep") as mock_sleep:
        result = retry.retry_terminal_report(report)

    assert result is True
    assert len(calls) == 3
    assert mock_sleep.call_args_list == [call(0.2), call(0.4)]


def test_retry_terminal_report_gives_up_after_exhausting_all_attempts():
    calls = []

    def report():
        calls.append(1)
        raise _FakeRpcError(grpc.StatusCode.UNAVAILABLE)

    with patch.object(retry.time, "sleep") as mock_sleep:
        result = retry.retry_terminal_report(report)

    assert result is False
    assert len(calls) == 3
    assert mock_sleep.call_count == 2


def test_retry_terminal_report_gives_up_immediately_on_permanent_failure():
    calls = []

    def report():
        calls.append(1)
        raise _FakeRpcError(grpc.StatusCode.NOT_FOUND)

    with patch.object(retry.time, "sleep") as mock_sleep:
        result = retry.retry_terminal_report(report)

    assert result is False
    assert len(calls) == 1
    mock_sleep.assert_not_called()
