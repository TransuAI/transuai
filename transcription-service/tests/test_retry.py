import pytest

from app.core.config import settings
from app.services import retry


# --- retry_queue_for：純函式，不碰真正的 RabbitMQ/pika（跟 ai-service 同一套設計）---


def test_retry_queue_for_first_retry_routes_to_2s_queue():
    assert retry.retry_queue_for(0) == settings.retry_queue_2s


def test_retry_queue_for_second_retry_routes_to_4s_queue():
    assert retry.retry_queue_for(1) == settings.retry_queue_4s


@pytest.mark.parametrize("retry_count", [2, 3, 100])
def test_retry_queue_for_exhausted_budget_returns_none(retry_count):
    assert retry.retry_queue_for(retry_count) is None
