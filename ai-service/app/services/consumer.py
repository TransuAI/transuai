import logging
import time
from typing import Callable

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings
from app.services.event_publisher import connection_params, publish_ai_completed, publish_job_failed
from app.services.pipeline import process_message
from app.services.reembed import process_transcript_edited
from app.services.regeneration import process_regeneration_requested
from app.services.retry import RETRY_COUNT_HEADER, RetryableMessageError, retry_queue_declarations, retry_queue_for

logger = logging.getLogger(__name__)

_INITIAL_RETRY_DELAY_SECONDS = 1
_MAX_RETRY_DELAY_SECONDS = 30


# 處理一則訊息：(body, channel, retry_count)。遇到暫時性失敗且還有重試預算時 raise
# RetryableMessageError，由 on_message 送進「這個 queue 自己的」retry queue。
MessageHandler = Callable[[bytes, BlockingChannel, int], None]


def _handle_transcription_completed(body: bytes, ch: BlockingChannel, retry_count: int) -> None:
    process_message(
        body,
        lambda job_id: publish_ai_completed(ch, job_id),
        lambda job_id, stage, error_reason: publish_job_failed(ch, job_id, stage, error_reason),
        retry_count=retry_count,
    )


def _handle_transcript_edited(body: bytes, _ch: BlockingChannel, retry_count: int) -> None:
    process_transcript_edited(body, retry_count=retry_count)


def _handle_regeneration_requested(body: bytes, _ch: BlockingChannel, retry_count: int) -> None:
    process_regeneration_requested(body, retry_count=retry_count)


def _handlers() -> dict[str, MessageHandler]:
    """ai-service 消費的每個 queue 跟它的處理函式。每個 queue 各有自己的 retry queue（見
    retry.retry_queue_declarations()），重試時才會回到同一個處理函式。"""
    return {
        settings.transcription_completed_queue: _handle_transcription_completed,
        settings.transcript_edited_queue: _handle_transcript_edited,
        settings.summary_regeneration_requested_queue: _handle_regeneration_requested,
    }


def _on_message_for(queue: str, handler: MessageHandler) -> Callable[..., None]:
    def on_message(ch, method, properties, body):
        # 刻意不用 try/finally 包 ack：如果 requeue 用的 basic_publish 本身失敗（例如 channel
        # 斷線），這裡要讓例外繼續往外冒、不 ack 這則訊息——ack 之後才發現 retry queue 沒收到
        # 訊息，等於這則訊息平白消失。不 ack 的話，訊息會在連線斷掉時被 RabbitMQ 自動 requeue，
        # 交給 consumer.py 既有的重連邏輯處理，而不是在這裡假裝重試已經送出去。
        #
        # 但處理函式本身也可能 raise 其他跟這個重試機制無關的例外（例如 payload 根本不是合法
        # JSON、缺欄位），這種情況要照舊 ack 掉，不能讓它一路冒到 channel.start_consuming()：
        # 這則訊息沒被 ack 會在重連後被 RabbitMQ 重新投遞，同一個 payload 錯誤會立刻再炸一次，
        # 變成無窮 crash/reconnect 迴圈，而且 prefetch_count=1 會讓後面所有訊息一起卡住。
        retry_count = (properties.headers or {}).get(RETRY_COUNT_HEADER, 0)
        try:
            handler(body, ch, retry_count)
        except RetryableMessageError:
            retry_queue = retry_queue_for(queue, retry_count)
            assert retry_queue is not None, "處理函式只在還有重試預算時才 raise RetryableMessageError"
            ch.basic_publish(
                exchange="",
                routing_key=retry_queue,
                body=body,
                properties=pika.BasicProperties(
                    content_type="application/json",
                    delivery_mode=2,
                    headers={RETRY_COUNT_HEADER: retry_count + 1},
                ),
            )
            logger.info(
                "requeueing message from %s onto %s (retry_count %d -> %d)",
                queue, retry_queue, retry_count, retry_count + 1)
        except Exception:
            logger.exception(
                "handler for %s raised an unexpected exception outside its own handling, "
                "acking to avoid a poison-message crash/reconnect loop", queue)
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        ch.basic_ack(delivery_tag=method.delivery_tag)

    return on_message


def _consume_once() -> None:
    connection = pika.BlockingConnection(connection_params())
    try:
        channel = connection.channel()
        channel.queue_declare(queue=settings.ai_completed_queue, durable=True)
        channel.queue_declare(queue=settings.job_failed_queue, durable=True)
        channel.basic_qos(prefetch_count=1)

        for queue, handler in _handlers().items():
            channel.queue_declare(queue=queue, durable=True)
            for retry_queue, arguments in retry_queue_declarations(queue):
                channel.queue_declare(queue=retry_queue, durable=True, arguments=arguments)
            channel.basic_consume(queue=queue, on_message_callback=_on_message_for(queue, handler))
            logger.info("consuming from %s", queue)

        try:
            channel.start_consuming()
        except KeyboardInterrupt:
            channel.stop_consuming()
            raise
    finally:
        connection.close()


def run_consumer() -> None:
    """建連線/消費中斷（RabbitMQ 重啟、DNS 暫時解析失敗等）時用指數退避重連，
    避免 consumer thread 死掉後就永久停止消費（pod 本身因為 gRPC server 還活著，
    不會因此被判定 unhealthy，訊息會無聲無息地堆積在 queue 裡）。
    """
    delay = _INITIAL_RETRY_DELAY_SECONDS
    while True:
        connected_at = time.monotonic()
        try:
            _consume_once()
            return
        except KeyboardInterrupt:
            return
        except Exception:
            if time.monotonic() - connected_at > _MAX_RETRY_DELAY_SECONDS:
                delay = _INITIAL_RETRY_DELAY_SECONDS
            logger.exception(
                "RabbitMQ consumer connection lost, retrying in %ss", delay)
            time.sleep(delay)
            delay = min(delay * 2, _MAX_RETRY_DELAY_SECONDS)
