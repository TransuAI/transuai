import logging
import time

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings
from app.services.event_publisher import connection_params, publish_job_failed, publish_transcription_completed
from app.services.pipeline import process_message
from app.services.retry import RETRY_COUNT_HEADER, RetryableMessageError, retry_queue_for

logger = logging.getLogger(__name__)

_INITIAL_RETRY_DELAY_SECONDS = 1
_MAX_RETRY_DELAY_SECONDS = 30


def _declare_retry_queue(channel: BlockingChannel, queue: str, ttl_ms: int) -> None:
    channel.queue_declare(
        queue=queue,
        durable=True,
        arguments={
            "x-message-ttl": ttl_ms,
            # default exchange 的 routing key 就是 queue 名稱，訊息 TTL 到期後自動被 dead-letter
            # 回原本的處理 queue，不需要宣告新的 exchange（見 ai-service 的 ADR 0001）。
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": settings.transcription_requested_queue,
        },
    )


def _consume_once() -> None:
    connection = pika.BlockingConnection(connection_params())
    try:
        channel = connection.channel()
        channel.queue_declare(
            queue=settings.transcription_requested_queue, durable=True)
        channel.queue_declare(
            queue=settings.transcription_completed_queue, durable=True)
        channel.queue_declare(
            queue=settings.job_failed_queue, durable=True)
        _declare_retry_queue(channel, settings.retry_queue_2s, 2000)
        _declare_retry_queue(channel, settings.retry_queue_4s, 4000)
        channel.basic_qos(prefetch_count=1)

        def on_message(ch, method, properties, body):
            # 刻意不用 try/finally 包 ack：如果 requeue 用的 basic_publish 本身失敗（例如 channel
            # 斷線），要讓例外繼續往外冒、不 ack 這則訊息——不然 ack 之後才發現 retry queue 沒收到
            # 訊息，這則訊息就平白消失了。不 ack 的話，訊息會在連線斷掉時被 RabbitMQ 自動 requeue，
            # 交給既有的重連邏輯處理。
            #
            # 但 process_message() 本身也可能 raise 其他跟這個重試機制無關的例外（例如 payload
            # 根本不是合法 JSON、缺欄位——這幾行在 process_message() 自己的 try/except 之外，見
            # pipeline.py），這種情況要照舊 ack 掉，不能讓它一路冒到 channel.start_consuming()：
            # 這則訊息沒被 ack 會在重連後被 RabbitMQ 重新投遞，同一個 payload 錯誤會立刻再炸一次，
            # 變成無窮 crash/reconnect 迴圈，而且 prefetch_count=1 會讓後面所有訊息一起卡住。
            retry_count = (properties.headers or {}).get(RETRY_COUNT_HEADER, 0)
            try:
                process_message(
                    body,
                    lambda job_id: publish_transcription_completed(ch, job_id),
                    lambda job_id, stage, error_reason: publish_job_failed(
                        ch, job_id, stage, error_reason),
                    retry_count=retry_count,
                )
            except RetryableMessageError:
                queue = retry_queue_for(retry_count)
                assert queue is not None, "process_message 只在還有重試預算時才 raise RetryableMessageError"
                ch.basic_publish(
                    exchange="",
                    routing_key=queue,
                    body=body,
                    properties=pika.BasicProperties(
                        content_type="application/json",
                        delivery_mode=2,
                        headers={RETRY_COUNT_HEADER: retry_count + 1},
                    ),
                )
                logger.info(
                    "requeueing message onto %s (retry_count %d -> %d)",
                    queue, retry_count, retry_count + 1)
            except Exception:
                logger.exception(
                    "process_message raised an unexpected exception outside its own handling, "
                    "acking to avoid a poison-message crash/reconnect loop")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return
            ch.basic_ack(delivery_tag=method.delivery_tag)

        channel.basic_consume(
            queue=settings.transcription_requested_queue, on_message_callback=on_message)
        logger.info("consuming from %s", settings.transcription_requested_queue)
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
