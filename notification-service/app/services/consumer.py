import asyncio
import json
import logging
import time

import pika

from app.core.config import settings
from app.services.connection_manager import connection_manager

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


def _consume_once(loop: asyncio.AbstractEventLoop) -> None:
    """對應 ../architecture-design.md 5. MQ Topics/Queues：消費 ai.completed / job.failed。

    pika 是同步 library，這個函式跑在獨立 thread；收到訊息後用
    asyncio.run_coroutine_threadsafe 把廣播這件事丟回 main.py 起 uvicorn 用的
    asyncio event loop 執行（WebSocket 的 send 是 async API，不能直接在這個 thread await）。
    """
    connection = pika.BlockingConnection(_connection_params())
    try:
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
            raise
    finally:
        connection.close()


def run_consumer(loop: asyncio.AbstractEventLoop) -> None:
    """建連線/消費中斷（RabbitMQ 重啟、DNS 暫時解析失敗等）時用指數退避重連，
    避免 consumer thread 死掉後就永久停止轉發 WebSocket 通知。
    """
    delay = _INITIAL_RETRY_DELAY_SECONDS
    while True:
        connected_at = time.monotonic()
        try:
            _consume_once(loop)
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
