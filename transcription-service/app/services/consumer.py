import logging

import pika

from app.core.config import settings
from app.services.event_publisher import publish_job_failed, publish_transcription_completed
from app.services.pipeline import process_message

logger = logging.getLogger(__name__)


def _connection_params() -> pika.ConnectionParameters:
    return pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        credentials=pika.PlainCredentials(
            settings.rabbitmq_user, settings.rabbitmq_password),
    )


def run_consumer() -> None:
    connection = pika.BlockingConnection(_connection_params())
    channel = connection.channel()
    channel.queue_declare(
        queue=settings.transcription_requested_queue, durable=True)
    channel.queue_declare(
        queue=settings.transcription_completed_queue, durable=True)
    channel.queue_declare(
        queue=settings.job_failed_queue, durable=True)
    channel.basic_qos(prefetch_count=1)

    def on_message(ch, method, _properties, body):
        try:
            process_message(
                body,
                lambda job_id: publish_transcription_completed(ch, job_id),
                lambda job_id, stage, error_reason: publish_job_failed(
                    ch, job_id, stage, error_reason),
            )
        finally:
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(
        queue=settings.transcription_requested_queue, on_message_callback=on_message)
    logger.info("consuming from %s", settings.transcription_requested_queue)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
    finally:
        connection.close()
