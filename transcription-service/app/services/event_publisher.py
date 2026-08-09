import json
import logging

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings

logger = logging.getLogger(__name__)


def publish_transcription_completed(channel: BlockingChannel, job_id: str) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：transcription.completed -> {jobId}。"""
    channel.queue_declare(queue=settings.transcription_completed_queue, durable=True)
    body = json.dumps({"jobId": job_id}).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=settings.transcription_completed_queue,
        body=body,
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("published transcription.completed for job %s", job_id)
