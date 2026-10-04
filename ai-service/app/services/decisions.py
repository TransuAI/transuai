"""決策紀錄要怎麼跑（抽取本身見 decision_extractor.py）：要求時把這個 Job 的抽取紀錄改成「抽取中」並排入 ai-service 自己的
decision.requested queue，背景用要求者的預設模型抽，完成才換掉 AI 上一次抽的（使用者改過或自己新增的保留）。類型是會議、訪談的 Job
轉錄完由 pipeline 自動要求（extract_after_transcription）。做法照講者數據（speaker_insight_runs.py）。

使用者可以改（edited）、自己新增（source = user）、刪掉決策；AI 抽的被刪掉只是隱藏（dismissed）。重新抽時這些都留著，而且新抽到的
如果跟它們在同一個片段（同一個時間點）就不收——改過的不會多出一份原本的、刪掉的不會再出現。"""

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from pika import BlockingConnection
from sqlalchemy import delete, select

from app.db import new_session
from app.models import Decision, DecisionExtraction, DecisionExtractionStatus, DecisionSource
from app.repositories.chapter_repository import find_by_job_id as find_chapters
from app.repositories.summary_repository import find_by_job_id as find_summary
from app.services.decision_extractor import DecisionFormatError, ExtractedDecision, extract_decisions
from app.services.default_models import resolve_chat_model
from app.services.embedder import embed_documents
from app.services.event_publisher import connection_params, publish_decisions_requested
from app.services.llm_client import ChatModel, LlmError
from app.services.platform_quota import LIMIT_REASON, platform_tokens_left
from app.services.regeneration import STUCK_AFTER
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

# 轉錄完自動抽決策的類型（upload-service 的 JobCategory）；其他類型在 Studio 手動抽。
AUTO_CATEGORIES = ("meeting", "interview")
STUCK_REASON = "抽取逾時，請再抽一次"
FORMAT_REASON = "模型回傳的格式不正確，請再抽一次"


MAX_STATEMENT_CHARS = 300
MAX_RATIONALE_CHARS = 1000
MAX_ALTERNATIVES = 10
MAX_ALTERNATIVE_CHARS = 200
_MAX_SPEAKER_LABEL_CHARS = 32


class DecisionsNotQueued(Exception):
    """The request couldn't be put on the queue; nothing changed."""


class InvalidDecision(Exception):
    """The decision the user wrote breaks a rule; the message says which, for the user."""


class DecisionNotFound(Exception):
    pass


@dataclass(frozen=True)
class DecisionFields:
    """決策可以改的內容。"""

    statement: str
    rationale: str
    alternatives: list[str]
    proposed_by: str | None
    tentative: bool


def effective_status(extraction: DecisionExtraction,
                     now: datetime | None = None) -> tuple[DecisionExtractionStatus, str | None]:
    """「抽取中」超過 STUCK_AFTER 的當成失敗（例如服務中途重啟），使用者才能再抽。"""
    now = now or datetime.now(timezone.utc)
    if extraction.status == DecisionExtractionStatus.GENERATING and now - extraction.requested_at >= STUCK_AFTER:
        return DecisionExtractionStatus.FAILED, STUCK_REASON
    return DecisionExtractionStatus(extraction.status), extraction.failure_reason


def find_job_decisions(job_id: uuid.UUID) -> tuple[DecisionExtraction | None, list[Decision]]:
    """抽取紀錄（沒抽過是 None）與決策：依時間點排序，沒有時間點的（使用者新增的）在後。"""
    with new_session() as session:
        extraction = session.scalar(select(DecisionExtraction).where(DecisionExtraction.job_id == job_id))
        found = session.scalars(select(Decision).where(Decision.job_id == job_id, Decision.dismissed.is_(False))
                                .order_by(Decision.start_time.asc().nulls_last(), Decision.created_at)).all()
        return extraction, list(found)


def request_decision_extraction(job_id: uuid.UUID, user_id: uuid.UUID) -> DecisionExtraction:
    """把這個 Job 的抽取紀錄改成「抽取中」並排入 queue，立即回傳。已經在抽（還沒卡住）就直接回傳它，不重複排。排入失敗時恢復原狀
    （第一次就刪掉），raise DecisionsNotQueued。"""
    with new_session() as session:
        extraction = session.scalar(
            select(DecisionExtraction).where(DecisionExtraction.job_id == job_id).with_for_update())
        if extraction is not None and effective_status(extraction)[0] == DecisionExtractionStatus.GENERATING:
            return extraction
        before = None if extraction is None else (
            extraction.status, extraction.failure_reason, extraction.requested_at, extraction.requested_by)
        if extraction is None:
            extraction = DecisionExtraction(job_id=job_id)
            session.add(extraction)
        extraction.requested_by, extraction.status, extraction.failure_reason = (
            user_id, DecisionExtractionStatus.GENERATING, None)
        extraction.requested_at = datetime.now(timezone.utc)
        session.commit()
        try:
            _queue(str(job_id), str(user_id))
        except Exception as exc:
            logger.exception("could not queue a decision extraction for job %s", job_id)
            if before is None:
                session.delete(extraction)
            else:
                extraction.status, extraction.failure_reason, extraction.requested_at, extraction.requested_by = before
            session.commit()
            raise DecisionsNotQueued() from exc
        return extraction


def create_decision(job_id: uuid.UUID, user_id: uuid.UUID, fields: DecisionFields,
                    start_time: float | None) -> Decision:
    """使用者自己新增的決策（source = user）；時間點可以沒有。內容不合規則 raise InvalidDecision。"""
    fields = _validated(fields)
    if start_time is not None and start_time < 0:
        raise InvalidDecision("時間點不能是負的")
    with new_session() as session:
        decision = Decision(job_id=job_id, user_id=user_id, statement=fields.statement, rationale=fields.rationale,
                            alternatives=fields.alternatives, proposed_by=fields.proposed_by, tentative=fields.tentative,
                            start_time=start_time, source=DecisionSource.USER, embedding=_embedding_or_none(fields))
        session.add(decision)
        session.commit()
        return decision


def update_decision(job_id: uuid.UUID, decision_id: uuid.UUID, fields: DecisionFields) -> Decision:
    """改決策的內容（時間點與原話不變），標記 edited。不是這個 Job 的（或刪掉了）raise DecisionNotFound。"""
    fields = _validated(fields)
    with new_session() as session:
        decision = _one(session, job_id, decision_id)
        if (decision.statement, decision.rationale) != (fields.statement, fields.rationale):
            decision.embedding = _embedding_or_none(fields)
        decision.statement, decision.rationale, decision.alternatives = (
            fields.statement, fields.rationale, fields.alternatives)
        decision.proposed_by, decision.tentative = fields.proposed_by, fields.tentative
        decision.edited, decision.updated_at = True, datetime.now(timezone.utc)
        session.commit()
        return decision


def delete_decision(job_id: uuid.UUID, decision_id: uuid.UUID) -> None:
    """AI 抽的只是隱藏（重新抽時不再出現），使用者新增的直接刪掉。不是這個 Job 的 raise DecisionNotFound。"""
    with new_session() as session:
        decision = _one(session, job_id, decision_id)
        if decision.source == DecisionSource.USER:
            session.delete(decision)
        else:
            decision.dismissed, decision.updated_at = True, datetime.now(timezone.utc)
        session.commit()


def _one(session, job_id: uuid.UUID, decision_id: uuid.UUID) -> Decision:
    decision = session.scalar(select(Decision).where(
        Decision.id == decision_id, Decision.job_id == job_id, Decision.dismissed.is_(False)).with_for_update())
    if decision is None:
        raise DecisionNotFound()
    return decision


def _validated(fields: DecisionFields) -> DecisionFields:
    statement, rationale = fields.statement.strip(), fields.rationale.strip()
    alternatives = [a.strip() for a in fields.alternatives if a.strip()]
    if not statement:
        raise InvalidDecision("決定不能是空的")
    if len(statement) > MAX_STATEMENT_CHARS:
        raise InvalidDecision(f"決定最多 {MAX_STATEMENT_CHARS} 字")
    if len(rationale) > MAX_RATIONALE_CHARS:
        raise InvalidDecision(f"理由最多 {MAX_RATIONALE_CHARS} 字")
    if len(alternatives) > MAX_ALTERNATIVES or any(len(a) > MAX_ALTERNATIVE_CHARS for a in alternatives):
        raise InvalidDecision(f"沒選的選項最多 {MAX_ALTERNATIVES} 個、每個 {MAX_ALTERNATIVE_CHARS} 字")
    if fields.proposed_by and len(fields.proposed_by) > _MAX_SPEAKER_LABEL_CHARS:
        raise InvalidDecision("不認得這位講者")
    return DecisionFields(statement, rationale, alternatives, fields.proposed_by or None, fields.tentative)


def _embedding_or_none(fields: DecisionFields) -> list[float] | None:
    """使用者改或新增時就算好 embedding；算不出來先存沒有的（決策本身比搜不搜得到重要）。"""
    try:
        return embed_documents([embedding_text(fields.statement, fields.rationale)])[0]
    except Exception:
        logger.exception("could not embed a decision, saving it without")
        return None


def extract_after_transcription(job_id: uuid.UUID, user_id: uuid.UUID | None, category: str | None,
                                model: ChatModel) -> None:
    """pipeline 取完標題與類型之後：會議、訪談就要求抽決策（用 Job 擁有者的預設模型）。不知道擁有者、平台模型這個月已經到上限就
    跳過（使用者之後可以手動抽）。附加功能：任何失敗只記 log，Job 照樣完成。"""
    if user_id is None or category not in AUTO_CATEGORIES:
        return
    try:
        if not platform_tokens_left(user_id, model):
            logger.info("job %s: the monthly platform limit is reached, not extracting decisions", job_id)
            return
        request_decision_extraction(job_id, user_id)
    except Exception:
        logger.exception("job %s: could not start extracting decisions", job_id)


def _queue(job_id: str, user_id: str) -> None:
    # Runs inside the user's request (or the pipeline): short timeouts, one attempt, publisher confirms (as quizzes.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_decisions_requested(channel, job_id, user_id)
    finally:
        connection.close()


def process_decisions_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 decision.requested { jobId, userId }：讀目前的逐字稿、摘要與章節，用要求者的預設模型抽決策、算 embedding，完成才換掉
    AI 上一次抽的。用平台模型時先檢查每月上限。格式不對是永久性失敗；暫時性失敗且還有重試預算時 raise RetryableMessageError；
    其他失敗設成「失敗」並附原因（之前的決策都保留）。"""
    payload = json.loads(body)
    job_id, user_id = uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    try:
        if not _still_generating(job_id):
            logger.info("decisions of job %s are no longer being extracted, dropping the request", job_id)
            return
        model = resolve_chat_model(user_id)
        if not platform_tokens_left(user_id, model):
            _fail(job_id, LIMIT_REASON)
            return
        transcript = transcript_client.get_transcript(str(job_id))
        with new_session() as session:
            summary = find_summary(session, job_id)
            chapters = [(chapter.title, float(chapter.start_time)) for chapter in find_chapters(session, job_id)]
        found = extract_decisions(transcript, (summary.summary_text or "") if summary else "", chapters, model=model,
                                  meter=UsageMeter(user_id, job_id, LlmFeature.DECISION_EXTRACTION))
        vectors = _embeddings(found, retry_count)
        _save(job_id, user_id, found, vectors, transcript.revision, model)
    except DecisionFormatError as exc:
        logger.warning("decisions of job %s: the model's reply was not valid: %s", job_id, exc)
        _fail(job_id, FORMAT_REASON)
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"decisions {job_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("extracting the decisions of job %s failed", job_id)
        _fail(job_id, str(exc) if isinstance(exc, LlmError) else "抽取失敗，請再試一次")
        return
    logger.info("extracted %d decisions from job %s at revision %s", len(found), job_id, transcript.revision)


def _embeddings(found: list[ExtractedDecision], retry_count: int) -> list[list[float] | None]:
    """決定＋理由的 embedding（搜尋與找取代的候選用）。暫時連不上而且還能重試就整則重試；不然先存沒有 embedding 的決策——決策本身
    比搜不搜得到重要。"""
    if not found:
        return []
    try:
        return embed_documents([embedding_text(d.statement, d.rationale) for d in found])
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise
        logger.exception("could not embed %d decisions, saving them without", len(found))
        return [None] * len(found)


def embedding_text(statement: str, rationale: str) -> str:
    return f"{statement}\n{rationale}" if rationale else statement


def _still_generating(job_id: uuid.UUID) -> bool:
    with new_session() as session:
        extraction = session.scalar(select(DecisionExtraction).where(DecisionExtraction.job_id == job_id))
        return extraction is not None and extraction.status == DecisionExtractionStatus.GENERATING


def _save(job_id: uuid.UUID, user_id: uuid.UUID, found: list[ExtractedDecision], vectors: list[list[float] | None],
          source_revision: int, model: ChatModel) -> None:
    with new_session() as session:
        extraction = session.scalar(
            select(DecisionExtraction).where(DecisionExtraction.job_id == job_id).with_for_update())
        if extraction is None:
            return
        session.execute(delete(Decision).where(
            Decision.job_id == job_id, Decision.source == DecisionSource.AI, Decision.edited.is_(False),
            Decision.dismissed.is_(False)))
        # What stays (edited, added, dismissed) holds its segment: a new one made there is the same decision again.
        held = {float(t) for t in session.scalars(select(Decision.start_time).where(
            Decision.job_id == job_id, Decision.start_time.is_not(None)))}
        session.add_all([
            Decision(job_id=job_id, user_id=user_id, statement=d.statement, rationale=d.rationale,
                     alternatives=d.alternatives, proposed_by=d.proposed_by, tentative=d.tentative,
                     start_time=d.start_time, evidence_text=d.evidence_text, source=DecisionSource.AI,
                     embedding=vector, source_revision=source_revision)
            for d, vector in zip(found, vectors) if d.start_time not in held])
        extraction.status, extraction.failure_reason = DecisionExtractionStatus.COMPLETED, None
        extraction.source_revision, extraction.model_provider, extraction.model = (
            source_revision, model.provider, model.model)
        extraction.completed_at = datetime.now(timezone.utc)
        session.commit()


def _fail(job_id: uuid.UUID, reason: str) -> None:
    try:
        with new_session() as session:
            extraction = session.scalar(select(DecisionExtraction).where(DecisionExtraction.job_id == job_id))
            if extraction is not None:
                extraction.status, extraction.failure_reason = DecisionExtractionStatus.FAILED, reason
                session.commit()
    except Exception:
        # Can't even record the failure: it stays GENERATING and reads as failed after STUCK_AFTER.
        logger.exception("could not mark the decision extraction of job %s as failed", job_id)
