from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import consumer
from app.services.retry import RETRY_COUNT_HEADER, RetryableMessageError


def _deliver(queue: str, handler, retry_count: int | None = None):
    """Runs the consumer's callback for one message on `queue`, the way pika would, and returns
    the fake channel so the test can see what was published and acked."""
    channel = MagicMock(name="channel")
    headers = {} if retry_count is None else {RETRY_COUNT_HEADER: retry_count}
    consumer._on_message_for(queue, handler)(
        channel, SimpleNamespace(delivery_tag=7), SimpleNamespace(headers=headers), b'{"jobId": "j"}')
    return channel


def _needs_retry(_body, _ch, _retry_count):
    raise RetryableMessageError("transient")


def test_a_retryable_failure_goes_to_the_retry_queue_of_the_queue_it_came_from():
    channel = _deliver("transcript.edited", _needs_retry, retry_count=1)

    publish = channel.basic_publish.call_args.kwargs
    assert publish["routing_key"] == "transcript.edited.retry.4s"
    assert publish["properties"].headers == {RETRY_COUNT_HEADER: 2}
    channel.basic_ack.assert_called_once_with(delivery_tag=7)


def test_the_handler_gets_the_messages_retry_count():
    handler = MagicMock()

    _deliver("transcription.completed", handler, retry_count=1)

    assert handler.call_args.args[2] == 1


def test_an_unexpected_error_is_acked_so_it_cannot_block_the_queue():
    def broken(_body, _ch, _retry_count):
        raise ValueError("not json")

    channel = _deliver("transcription.completed", broken)

    channel.basic_publish.assert_not_called()
    channel.basic_ack.assert_called_once_with(delivery_tag=7)
