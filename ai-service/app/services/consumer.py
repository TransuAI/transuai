import logging
import time

import pika

from app.core.config import settings
from app.services.event_publisher import publish_ai_completed, publish_job_failed
from app.services.pipeline import process_message

logger = logging.getLogger(__name__)

_INITIAL_RETRY_DELAY_SECONDS = 1
_MAX_RETRY_DELAY_SECONDS = 30


def _connection_params() -> pika.ConnectionParameters:
    return pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        credentials=pika.PlainCredentials(
            settings.rabbitmq_user, settings.rabbitmq_password),
    )


def _consume_once() -> None:
    connection = pika.BlockingConnection(_connection_params())
    try:
        channel = connection.channel()
        channel.queue_declare(
            queue=settings.transcription_completed_queue, durable=True)
        channel.queue_declare(
            queue=settings.ai_completed_queue, durable=True)
        channel.queue_declare(
            queue=settings.job_failed_queue, durable=True)
        channel.basic_qos(prefetch_count=1)

        def on_message(ch, method, _properties, body):
            try:
                process_message(
                    body,
                    lambda job_id: publish_ai_completed(ch, job_id),
                    lambda job_id, stage, error_reason: publish_job_failed(
                        ch, job_id, stage, error_reason),
                )
            finally:
                ch.basic_ack(delivery_tag=method.delivery_tag)

        channel.basic_consume(
            queue=settings.transcription_completed_queue, on_message_callback=on_message)
        logger.info("consuming from %s", settings.transcription_completed_queue)
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
