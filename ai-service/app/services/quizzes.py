"""測驗（見 CONTEXT.md「測驗」）：要求產生時建立「產生中」並排入 ai-service 自己的 quiz.requested queue，
背景依整個 Job 的逐字稿用要求者的預設模型出題。做法照「重新產生摘要」（regeneration.py）。"""

import json
import logging
import uuid
from datetime import datetime, timezone

from pika import BlockingConnection

from app.db import new_session
from app.models import Quiz, QuizQuestion, QuizStatus
from app.repositories.quiz_repository import complete_quiz, fail_quiz
from app.services.default_models import resolve_chat_model
from app.services.event_publisher import connection_params, publish_quiz_requested
from app.services.llm_client import ChatModel, LlmError
from app.services.quiz_generator import GeneratedQuestion, QuizFormatError, generate_quiz
from app.services.regeneration import STUCK_AFTER
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.speaker_context import chapter_input
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

QUESTION_COUNTS = (5, 10, 20)
STUCK_REASON = "產生逾時，請再產生一次"


class InvalidQuestionCount(Exception):
    pass


class QuizNotQueued(Exception):
    """The request couldn't be put on the queue; no quiz was created."""


def effective_status(quiz: Quiz, now: datetime | None = None) -> tuple[QuizStatus, str | None]:
    """對外回報的狀態與失敗原因：「產生中」超過 STUCK_AFTER 的當成失敗（例如服務中途重啟），使用者才能再產生。"""
    now = now or datetime.now(timezone.utc)
    if quiz.status == QuizStatus.GENERATING and now - quiz.requested_at >= STUCK_AFTER:
        return QuizStatus.FAILED, STUCK_REASON
    return QuizStatus(quiz.status), quiz.failure_reason


def _queue(quiz_id: str, job_id: str, user_id: str) -> None:
    # Runs inside the user's request: short timeouts, one connection attempt, publisher confirms
    # (the same approach as regeneration.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_quiz_requested(channel, quiz_id, job_id, user_id)
    finally:
        connection.close()


def request_quiz(job_id: uuid.UUID, user_id: uuid.UUID, question_count: int) -> Quiz:
    """建立一份「產生中」的測驗並排入 queue，立即回傳。先存好才排入（背景工作一收到就讀得到它）；排入失敗時把它
    刪掉，什麼都不留下（raise QuizNotQueued）。"""
    if question_count not in QUESTION_COUNTS:
        raise InvalidQuestionCount()
    session = new_session()
    try:
        quiz = Quiz(job_id=job_id, user_id=user_id, question_count=question_count, status=QuizStatus.GENERATING,
                    requested_at=datetime.now(timezone.utc))
        session.add(quiz)
        session.commit()
        try:
            _queue(str(quiz.id), str(job_id), str(user_id))
        except Exception as exc:
            logger.exception("could not queue a quiz for job %s", job_id)
            session.delete(quiz)
            session.commit()
            raise QuizNotQueued() from exc
        return quiz
    finally:
        session.close()


def process_quiz_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 quiz.requested { quizId, jobId, userId }：讀目前的逐字稿（排除已清空片段，兩位以上講者時每行帶
    名稱），用要求者的預設模型出題，驗證通過才連同題目把測驗設成「完成」。

    模型回傳的格式不對是永久性失敗（不重試）；暫時性失敗且還有重試預算時 raise RetryableMessageError（這個
    queue 自己的 retry queue）；其他失敗（包含自有金鑰不能用——不改用平台模型）與重試用完都設成「失敗」並附原因。
    """
    payload = json.loads(body)
    quiz_id, job_id, user_id = uuid.UUID(payload["quizId"]), uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    try:
        question_count = _still_generating(quiz_id)
        if question_count is None:
            logger.info("quiz %s is gone or no longer being generated, dropping its request", quiz_id)
            return
        transcript = transcript_client.get_transcript(str(job_id))
        lines = chapter_input(transcript)
        if not lines:
            _fail(quiz_id, "逐字稿沒有內容，無法出題")
            return
        model = resolve_chat_model(user_id)
        questions = generate_quiz(lines, question_count, model=model, meter=UsageMeter(user_id, job_id, LlmFeature.QUIZ))
        _save(quiz_id, questions, transcript.revision, model)
    except QuizFormatError as exc:
        logger.warning("quiz %s of job %s: the model's reply was not a valid quiz: %s", quiz_id, job_id, exc)
        _fail(quiz_id, f"模型回傳的測驗格式不正確（{exc}），請再產生一次")
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"quiz {quiz_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("generating quiz %s of job %s failed", quiz_id, job_id)
        _fail(quiz_id, _failure_reason(exc))
        return
    logger.info("generated quiz %s of job %s from revision %s", quiz_id, job_id, transcript.revision)


def _still_generating(quiz_id: uuid.UUID) -> int | None:
    """題數，如果這份測驗還在產生中；RabbitMQ 至少送達一次，已經完成或失敗的測驗維持原樣。"""
    session = new_session()
    try:
        quiz = session.get(Quiz, quiz_id)
        return quiz.question_count if quiz and quiz.status == QuizStatus.GENERATING else None
    finally:
        session.close()


def _save(quiz_id: uuid.UUID, questions: list[GeneratedQuestion], source_revision: int, model: ChatModel) -> None:
    session = new_session()
    try:
        complete_quiz(
            session, quiz_id,
            [QuizQuestion(quiz_id=quiz_id, position=position, kind=q.kind, prompt=q.prompt, options=q.options,
                          correct_option=q.correct_option, explanation=q.explanation,
                          source_timestamps=q.source_timestamps)
             for position, q in enumerate(questions, start=1)],
            source_revision=source_revision, model=(model.provider, model.model),
            completed_at=datetime.now(timezone.utc))
    finally:
        session.close()


def _failure_reason(exc: Exception) -> str:
    # A model error names the provider and why (e.g. an own key that ran out); anything else stays generic.
    return str(exc) if isinstance(exc, LlmError) else "產生測驗失敗，請再試一次"


def _fail(quiz_id: uuid.UUID, reason: str) -> None:
    session = new_session()
    try:
        fail_quiz(session, quiz_id, reason)
    except Exception:
        # Can't even record the failure: the quiz stays GENERATING and reads as failed after STUCK_AFTER.
        logger.exception("could not mark quiz %s as failed", quiz_id)
    finally:
        session.close()
