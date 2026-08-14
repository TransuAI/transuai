import httpx
import pytest
from groq import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

from app.core.config import settings
from app.services import retry


def _httpx_request() -> httpx.Request:
    return httpx.Request("POST", "https://example.invalid")


def _httpx_response(status_code: int) -> httpx.Response:
    return httpx.Response(status_code=status_code, request=_httpx_request())


# --- retry_queue_for：純函式，不碰真正的 RabbitMQ/pika（跟 ai-service 同一套設計）---


def test_retry_queue_for_first_retry_routes_to_2s_queue():
    assert retry.retry_queue_for(0) == settings.retry_queue_2s


def test_retry_queue_for_second_retry_routes_to_4s_queue():
    assert retry.retry_queue_for(1) == settings.retry_queue_4s


@pytest.mark.parametrize("retry_count", [2, 3, 100])
def test_retry_queue_for_exhausted_budget_returns_none(retry_count):
    assert retry.retry_queue_for(retry_count) is None


# --- Groq 例外分類（跟 ai-service 完全相同的分類規則）---


@pytest.mark.parametrize(
    "exc",
    [
        RateLimitError("rate limited", response=_httpx_response(429), body=None),
        InternalServerError("boom", response=_httpx_response(500), body=None),
        APIConnectionError(request=_httpx_request()),
        APITimeoutError(request=_httpx_request()),
    ],
)
def test_is_retryable_groq_error_true_for_transient_types(exc):
    assert retry.is_retryable_groq_error(exc) is True


@pytest.mark.parametrize(
    "exc",
    [
        BadRequestError("bad", response=_httpx_response(400), body=None),
        AuthenticationError("auth", response=_httpx_response(401), body=None),
        PermissionDeniedError("denied", response=_httpx_response(403), body=None),
        NotFoundError("missing", response=_httpx_response(404), body=None),
        ValueError("not even a groq error"),
    ],
)
def test_is_retryable_groq_error_false_for_permanent_types(exc):
    assert retry.is_retryable_groq_error(exc) is False
