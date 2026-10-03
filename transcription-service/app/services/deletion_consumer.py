"""消費刪除事件（upload-service 的 `job.deleted`、auth-service 的 `account.deleted`，都是 fanout exchange）：各綁一個這個服務自己的
佇列，交給對應的 handler。

跟轉錄的 consumer 分開一條 thread、一條連線：轉錄一則訊息可能要好幾分鐘，刪除不用排在它後面。處理失敗（例如資料庫連不上）就
nack 不 requeue，dead-letter 到 retry 佇列，等 `deletion_retry_delay_ms` 再回來，不限次數——刪除一定要做完。訊息本身不合法
（不是 JSON、沒有合法的 id）重試也沒用，記 log 後 ack。"""

import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings
from app.services import account_deletion, job_deletion
from app.services.consumer import run_with_reconnect
from app.services.event_publisher import connection_params

logger = logging.getLogger(__name__)


class InvalidDeletionMessage(Exception):
    pass


@dataclass(frozen=True)
class Subscription:
    exchange: str
    queue: str
    retry_queue: str
    handle: Callable[[dict], None]


def _uuid_field(payload: dict, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(payload[field]))
    except (KeyError, ValueError) as exc:
        raise InvalidDeletionMessage(f"{field} missing or not a UUID") from exc


def _on_job_deleted(payload: dict) -> None:
    job_deletion.delete_job_data(_uuid_field(payload, "jobId"))


def _on_account_deleted(payload: dict) -> None:
    account_deletion.delete_account_data(_uuid_field(payload, "userId"))


def subscriptions() -> list[Subscription]:
    return [
        Subscription(settings.job_deleted_exchange, settings.job_deleted_queue, settings.job_deleted_retry_queue,
                     _on_job_deleted),
        Subscription(settings.account_deleted_exchange, settings.account_deleted_queue,
                     settings.account_deleted_retry_queue, _on_account_deleted),
    ]


def declare(channel: BlockingChannel, subscription: Subscription) -> None:
    """exchange（fanout）、這個服務的佇列與綁定、retry 佇列；都 durable，重複宣告沒事。"""
    channel.exchange_declare(exchange=subscription.exchange, exchange_type="fanout", durable=True)
    channel.queue_declare(queue=subscription.retry_queue, durable=True, arguments={
        "x-message-ttl": settings.deletion_retry_delay_ms,
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": subscription.queue,
    })
    channel.queue_declare(queue=subscription.queue, durable=True, arguments={
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": subscription.retry_queue,
    })
    channel.queue_bind(queue=subscription.queue, exchange=subscription.exchange)


def handle(channel: BlockingChannel, delivery_tag: int, body: bytes, subscription: Subscription) -> None:
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise InvalidDeletionMessage("payload is not a JSON object")
        subscription.handle(payload)
    except (InvalidDeletionMessage, ValueError) as exc:
        logger.error("dropping invalid message on %s: %s", subscription.queue, exc)
        channel.basic_ack(delivery_tag=delivery_tag)
        return
    except Exception:
        logger.exception("could not handle message on %s, retrying in %sms", subscription.queue,
                         settings.deletion_retry_delay_ms)
        channel.basic_nack(delivery_tag=delivery_tag, requeue=False)
        return
    channel.basic_ack(delivery_tag=delivery_tag)


def _consume_once() -> None:
    connection = pika.BlockingConnection(connection_params())
    try:
        channel = connection.channel()
        channel.basic_qos(prefetch_count=1)
        for subscription in subscriptions():
            declare(channel, subscription)
            channel.basic_consume(
                queue=subscription.queue,
                on_message_callback=lambda ch, method, _props, body, s=subscription: handle(
                    ch, method.delivery_tag, body, s))
            logger.info("consuming from %s (bound to %s)", subscription.queue, subscription.exchange)
        channel.start_consuming()
    finally:
        connection.close()


def run_deletion_consumer() -> None:
    run_with_reconnect(_consume_once)
