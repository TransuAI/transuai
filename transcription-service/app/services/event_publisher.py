import json
import logging

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings

logger = logging.getLogger(__name__)


def connection_params(**overrides) -> pika.ConnectionParameters:
    """RabbitMQ 連線參數；overrides 給需要不同 timeout 的呼叫端（例如 edit_events）。"""
    return pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        credentials=pika.PlainCredentials(settings.rabbitmq_user, settings.rabbitmq_password),
        **overrides,
    )


def publish_transcription_completed(channel: BlockingChannel, job_id: str) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：transcription.completed -> {jobId}。"""
    channel.queue_declare(
        queue=settings.transcription_completed_queue, durable=True)
    body = json.dumps({"jobId": job_id}).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=settings.transcription_completed_queue,
        body=body,
        properties=pika.BasicProperties(
            content_type="application/json", delivery_mode=2),
    )
    logger.info("published transcription.completed for job %s", job_id)


def publish_job_failed(channel: BlockingChannel, job_id: str, stage: str, error_reason: str) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：job.failed -> {jobId, stage, errorReason}。"""
    channel.queue_declare(queue=settings.job_failed_queue, durable=True)
    body = json.dumps(
        {"jobId": job_id, "stage": stage, "errorReason": error_reason}).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=settings.job_failed_queue,
        body=body,
        properties=pika.BasicProperties(
            content_type="application/json", delivery_mode=2),
    )
    logger.info("published job.failed for job %s (stage=%s)", job_id, stage)


def publish_transcript_edited(channel: BlockingChannel, job_id: str) -> None:
    """transcript.edited -> {jobId}：使用者編輯逐字稿後通知 ai-service（見根目錄 docs/adr/0003）。"""
    channel.queue_declare(queue=settings.transcript_edited_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.transcript_edited_queue,
        body=json.dumps({"jobId": job_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
