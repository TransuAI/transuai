import asyncio
import json
import logging

import pika

from app.core.config import settings
from app.services.connection_manager import connection_manager

logger = logging.getLogger(__name__)


def _connection_params() -> pika.ConnectionParameters:
    return pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        credentials=pika.PlainCredentials(
            settings.rabbitmq_user, settings.rabbitmq_password),
    )


def _handle_ai_completed(loop: asyncio.AbstractEventLoop, body: bytes) -> None:
    payload = json.loads(body)
    job_id: str = payload["jobId"]
    message = {"jobId": job_id, "status": payload.get("status", "COMPLETED"), "progress": 100}
    asyncio.run_coroutine_threadsafe(connection_manager.broadcast(job_id, message), loop)


def _handle_job_failed(loop: asyncio.AbstractEventLoop, body: bytes) -> None:
    payload = json.loads(body)
    job_id: str = payload["jobId"]
    message = {
        "jobId": job_id,
        "status": "FAILED",
        "stage": payload.get("stage"),
        "errorReason": payload.get("errorReason"),
    }
    asyncio.run_coroutine_threadsafe(connection_manager.broadcast(job_id, message), loop)


def run_consumer(loop: asyncio.AbstractEventLoop) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：消費 ai.completed / job.failed。

    pika 是同步 library，這個函式跑在獨立 thread；收到訊息後用
    asyncio.run_coroutine_threadsafe 把廣播這件事丟回 main.py 起 uvicorn 用的
    asyncio event loop 執行（WebSocket 的 send 是 async API，不能直接在這個 thread await）。
    """
    connection = pika.BlockingConnection(_connection_params())
    channel = connection.channel()
    channel.queue_declare(queue=settings.ai_completed_queue, durable=True)
    channel.queue_declare(queue=settings.job_failed_queue, durable=True)
    channel.basic_qos(prefetch_count=1)

    def on_ai_completed(ch, method, _properties, body):
        try:
            _handle_ai_completed(loop, body)
        finally:
            ch.basic_ack(delivery_tag=method.delivery_tag)

    def on_job_failed(ch, method, _properties, body):
        try:
            _handle_job_failed(loop, body)
        finally:
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(queue=settings.ai_completed_queue, on_message_callback=on_ai_completed)
    channel.basic_consume(queue=settings.job_failed_queue, on_message_callback=on_job_failed)
    logger.info("consuming from %s, %s", settings.ai_completed_queue, settings.job_failed_queue)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
    finally:
        connection.close()
