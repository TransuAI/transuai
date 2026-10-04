import json
import logging

import pika
from pika.adapters.blocking_connection import BlockingChannel

from app.core.config import settings

logger = logging.getLogger(__name__)


def connection_params(**overrides) -> pika.ConnectionParameters:
    """RabbitMQ 連線參數；overrides 給需要不同 timeout 的呼叫端（例如從 gRPC 請求裡發訊息）。"""
    return pika.ConnectionParameters(
        host=settings.rabbitmq_host,
        port=settings.rabbitmq_port,
        credentials=pika.PlainCredentials(settings.rabbitmq_user, settings.rabbitmq_password),
        **overrides,
    )


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


def publish_regeneration_requested(channel: BlockingChannel, job_id: str, user_id: str | None) -> None:
    """summary.regeneration.requested -> {jobId, userId}：ai-service 排給自己的背景工作（重新產生摘要與章節）；
    userId 是要求重新產生的使用者，用量記在他名下。"""
    channel.queue_declare(queue=settings.summary_regeneration_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.summary_regeneration_requested_queue,
        body=json.dumps({"jobId": job_id} | ({"userId": user_id} if user_id else {})).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued summary.regeneration.requested for job %s", job_id)


def publish_quiz_requested(channel: BlockingChannel, quiz_id: str, job_id: str, user_id: str) -> None:
    """quiz.requested -> {quizId, jobId, userId}：ai-service 排給自己的背景工作（產生測驗）；userId 是要求產生的
    使用者，用他的預設模型、用量記在他名下。"""
    channel.queue_declare(queue=settings.quiz_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.quiz_requested_queue,
        body=json.dumps({"quizId": quiz_id, "jobId": job_id, "userId": user_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued quiz.requested for quiz %s of job %s", quiz_id, job_id)


def publish_speaker_insights_requested(channel: BlockingChannel, job_id: str, user_id: str) -> None:
    """speaker_insights.requested -> {jobId, userId}：ai-service 排給自己的背景工作（講者數據的問題與打斷）；userId 是要求分析的
    使用者，用他的預設模型、用量記在他名下。"""
    channel.queue_declare(queue=settings.speaker_insights_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.speaker_insights_requested_queue,
        body=json.dumps({"jobId": job_id, "userId": user_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued speaker_insights.requested for job %s", job_id)


def publish_decisions_requested(channel: BlockingChannel, job_id: str, user_id: str, meeting_at: str | None) -> None:
    """decision.requested -> {jobId, userId, meetingAt}：ai-service 排給自己的背景工作（抽出一場的決策，使用者要求或轉錄完自動）；
    userId 是要求的使用者（自動抽是 Job 擁有者），用他的預設模型、用量記在他名下；meetingAt（ISO 8601，Job 的上傳時間，可能沒有）是
    找較早的會議裡被取代的決策用的。"""
    payload = {"jobId": job_id, "userId": user_id} | ({"meetingAt": meeting_at} if meeting_at else {})
    channel.queue_declare(queue=settings.decision_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.decision_requested_queue,
        body=json.dumps(payload).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued decision.requested for job %s", job_id)


def publish_fact_check_requested(channel: BlockingChannel, job_id: str, user_id: str) -> None:
    """fact_check.requested -> {jobId, userId}：ai-service 排給自己的背景工作（事實查核：標出主張）；userId 是要求的使用者，用他的
    預設模型、用量記在他名下。"""
    channel.queue_declare(queue=settings.fact_check_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.fact_check_requested_queue,
        body=json.dumps({"jobId": job_id, "userId": user_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued fact_check.requested for job %s", job_id)


def publish_output_requested(channel: BlockingChannel, output_id: str, job_id: str, user_id: str) -> None:
    """output.requested -> {outputId, jobId, userId}：ai-service 排給自己的背景工作（多格式輸出）；userId 是要求產生的使用者，
    用他的預設模型、用量記在他名下。"""
    channel.queue_declare(queue=settings.output_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.output_requested_queue,
        body=json.dumps({"outputId": output_id, "jobId": job_id, "userId": user_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued output.requested for output %s of job %s", output_id, job_id)


def publish_translation_requested(channel: BlockingChannel, job_id: str, language: str) -> None:
    """translation.requested -> {jobId, language}：ai-service 排給自己的背景工作（翻譯逐字稿，也用在編輯後的重翻）；用量記在這份
    譯文最近一次要求翻譯的使用者名下。"""
    channel.queue_declare(queue=settings.translation_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.translation_requested_queue,
        body=json.dumps({"jobId": job_id, "language": language}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued translation.requested for job %s (%s)", job_id, language)


def publish_post_meeting_requested(channel: BlockingChannel, run_id: str, job_id: str, user_id: str) -> None:
    """post_meeting.requested -> {runId, jobId, userId}：ai-service 排給自己的背景工作（會後處理）；userId 是觸發的使用者，
    用他的預設模型與已連結的帳號、用量記在他名下。"""
    channel.queue_declare(queue=settings.post_meeting_requested_queue, durable=True)
    channel.basic_publish(
        exchange="",
        routing_key=settings.post_meeting_requested_queue,
        body=json.dumps({"runId": run_id, "jobId": job_id, "userId": user_id}).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )
    logger.info("queued post_meeting.requested for run %s of job %s", run_id, job_id)
