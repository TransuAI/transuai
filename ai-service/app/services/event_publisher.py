import json
import logging

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings

logger = logging.getLogger(__name__)


def publish_ai_completed(channel: BlockingChannel, job_id: str) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：ai.completed -> {jobId, status}。"""
    channel.queue_declare(queue=settings.ai_completed_queue, durable=True)
    body = json.dumps({"jobId": job_id, "status": "COMPLETED"}).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=settings.ai_completed_queue,
        body=body,
        properties=pika.BasicProperties(
            content_type="application/json", delivery_mode=2),
    )
    logger.info("published ai.completed for job %s", job_id)


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
