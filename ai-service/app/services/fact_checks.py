"""事實查核要怎麼跑（標出主張見 claim_extractor.py）：要求時把這個 Job 標出主張的紀錄改成「標出中」並排入 ai-service 自己的
fact_check.requested queue，背景用要求者的預設模型標出主張，完成才換掉上一次的。查核過的主張保留（查核花了搜尋次數），新標出的如果
跟它們在同一個片段就不收。只有說話者自己知道的事標成 not_checkable，不給勾選。做法照決策紀錄（decisions.py）。

查核勾選的主張（CheckClaims → claim_check.requested）：每條各自查一次網路（只送整理過的那一句）、依搜到的網頁判斷（claim_checker.py），
各自成功或失敗；搜尋失敗、判斷失敗的那條保持「還沒查」並記下原因。每次搜尋記 web_search_usage（feature = fact_check，跟問答共用
每月上限，剩餘次數由 gateway 先檢查）。"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, NamedTuple

from pika import BlockingConnection
from sqlalchemy import delete, select

from app.db import new_session
from app.models import Claim, FactCheck, FactCheckStatus, Verdict, WebSearchFeature
from app.repositories.web_search_usage_repository import save_web_search
from app.services import web_search
from app.services.claim_checker import NOTHING_FOUND_EXPLANATION, JudgeFormatError, judge_claim
from app.services.claim_extractor import ClaimFormatError, ExtractedClaim, extract_claims
from app.services.default_models import resolve_chat_model
from app.services.event_publisher import connection_params, publish_claim_check_requested, publish_fact_check_requested
from app.services.llm_client import ChatModel, LlmError
from app.services.platform_quota import LIMIT_REASON, platform_tokens_left
from app.services.regeneration import STUCK_AFTER
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

STUCK_REASON = "標出主張逾時，請再試一次"
FORMAT_REASON = "模型回傳的格式不正確，請再標出一次"
# 查核過的主張（花了搜尋次數）重新標出時保留。
_CHECKED = (Verdict.SUPPORTED, Verdict.DISPUTED, Verdict.NO_RELIABLE_SOURCE)
SEARCH_FAILED_REASON = "網路搜尋失敗，請再查一次"
JUDGE_FAILED_REASON = "判斷結論失敗，請再查一次"
CHECK_FAILED_REASON = "查核失敗，請再試一次"
CHECK_STUCK_REASON = "查核逾時，請再查一次"
# 一條主張「查核中」超過這麼久沒有結果，當成失敗（例如服務中途重啟），使用者才能再查。
CHECK_STUCK_AFTER = timedelta(minutes=10)


class ClaimNotFound(Exception):
    pass


class ClaimNotCheckable(Exception):
    pass


class WebSearchUnavailable(Exception):
    """This deployment has no web search set up."""


class FactCheckNotQueued(Exception):
    """The request couldn't be put on the queue; nothing changed."""


def effective_status(fact_check: FactCheck, now: datetime | None = None) -> tuple[FactCheckStatus, str | None]:
    """「標出中」超過 STUCK_AFTER 的當成失敗（例如服務中途重啟），使用者才能再標一次。"""
    now = now or datetime.now(timezone.utc)
    if fact_check.status == FactCheckStatus.GENERATING and now - fact_check.requested_at >= STUCK_AFTER:
        return FactCheckStatus.FAILED, STUCK_REASON
    return FactCheckStatus(fact_check.status), fact_check.failure_reason


def find_fact_check(job_id: uuid.UUID) -> tuple[FactCheck | None, list[Claim]]:
    """標出主張的紀錄（沒標過是 None）與主張（依時間點排序）。"""
    with new_session() as session:
        fact_check = session.scalar(select(FactCheck).where(FactCheck.job_id == job_id))
        claims = session.scalars(select(Claim).where(Claim.job_id == job_id).order_by(Claim.start_time, Claim.created_at))
        return fact_check, list(claims)


def request_fact_check(job_id: uuid.UUID, user_id: uuid.UUID) -> FactCheck:
    """把這個 Job 標出主張的紀錄改成「標出中」並排入 queue，立即回傳。已經在標（還沒卡住）就直接回傳它，不重複排。排入失敗時恢復
    原狀（第一次就刪掉），raise FactCheckNotQueued。"""
    with new_session() as session:
        fact_check = session.scalar(select(FactCheck).where(FactCheck.job_id == job_id).with_for_update())
        if fact_check is not None and effective_status(fact_check)[0] == FactCheckStatus.GENERATING:
            return fact_check
        before = None if fact_check is None else (
            fact_check.status, fact_check.failure_reason, fact_check.requested_at, fact_check.requested_by)
        if fact_check is None:
            fact_check = FactCheck(job_id=job_id)
            session.add(fact_check)
        fact_check.requested_by, fact_check.status, fact_check.failure_reason = (
            user_id, FactCheckStatus.GENERATING, None)
        fact_check.requested_at = datetime.now(timezone.utc)
        session.commit()
        try:
            _queue(publish_fact_check_requested, str(job_id), str(user_id))
        except Exception as exc:
            logger.exception("could not queue finding the claims of job %s", job_id)
            if before is None:
                session.delete(fact_check)
            else:
                fact_check.status, fact_check.failure_reason, fact_check.requested_at, fact_check.requested_by = before
            session.commit()
            raise FactCheckNotQueued() from exc
        return fact_check


class ClaimCheckState(NamedTuple):
    checking: bool
    error: str | None  # 上一次查核失敗的原因


def claim_check_state(claim: Claim, now: datetime | None = None) -> ClaimCheckState:
    """這條主張是不是查核中、上一次失敗的原因：查核中太久的當成失敗。"""
    now = now or datetime.now(timezone.utc)
    if claim.checking_since is not None and now - claim.checking_since >= CHECK_STUCK_AFTER:
        return ClaimCheckState(checking=False, error=CHECK_STUCK_REASON)
    return ClaimCheckState(checking=claim.checking_since is not None, error=claim.check_error)


def check_claims(job_id: uuid.UUID, user_id: uuid.UUID, claim_ids: list[uuid.UUID]) -> None:
    """把勾選的主張標成「查核中」並排入 claim_check.requested。已經在查（還沒卡住）的不重複排。不是這個 Job 的 raise ClaimNotFound；
    無法查核的 raise ClaimNotCheckable；沒有設定網路搜尋 raise WebSearchUnavailable；排入失敗時恢復原狀並 raise
    FactCheckNotQueued。"""
    if not web_search.is_available():
        raise WebSearchUnavailable()
    with new_session() as session:
        claims = list(session.scalars(select(Claim).where(Claim.id.in_(claim_ids), Claim.job_id == job_id)
                                      .with_for_update()))
        if len(claims) != len(set(claim_ids)):
            raise ClaimNotFound()
        if any(claim.verdict == Verdict.NOT_CHECKABLE for claim in claims):
            raise ClaimNotCheckable()
        to_check = [claim for claim in claims if not claim_check_state(claim).checking]
        if not to_check:
            return
        before = {claim.id: (claim.checking_since, claim.check_error) for claim in to_check}
        now = datetime.now(timezone.utc)
        for claim in to_check:
            claim.checking_since, claim.check_error = now, None
        session.commit()
        try:
            _queue(publish_claim_check_requested, str(job_id), str(user_id), [str(claim.id) for claim in to_check])
        except Exception as exc:
            logger.exception("could not queue checking claims of job %s", job_id)
            for claim in to_check:
                claim.checking_since, claim.check_error = before[claim.id]
            session.commit()
            raise FactCheckNotQueued() from exc


def process_claim_check_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 claim_check.requested { jobId, userId, claimIds }：每條各自查一次網路、判斷結論、存起來。一條的失敗不影響其他條，也不整則
    重試（重試會再花搜尋次數）——失敗的那條保持還沒查、記下原因，使用者可以再查。"""
    payload = json.loads(body)
    job_id, user_id = uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    model = None
    for claim_id in payload["claimIds"]:
        try:
            claim = _still_checking(uuid.UUID(claim_id), job_id)
            if claim is None:
                continue
            model = model or resolve_chat_model(user_id)
            _check_one(job_id, user_id, claim, model)
        except Exception:
            logger.exception("checking claim %s of job %s failed", claim_id, job_id)
            _claim_failed(uuid.UUID(claim_id), CHECK_FAILED_REASON)


def _check_one(job_id: uuid.UUID, user_id: uuid.UUID, claim: Claim, model: ChatModel) -> None:
    if not platform_tokens_left(user_id, model):
        # Before searching: a search spent on a claim the model then can't judge would be wasted.
        _claim_failed(claim.id, LIMIT_REASON)
        return
    try:
        pages = web_search.search(claim.claim)  # the claim's own sentence: nothing from the transcript leaves
    except web_search.WebSearchFailed:
        logger.warning("web search for claim %s of job %s failed", claim.id, job_id, exc_info=True)
        save_web_search(user_id, job_id, web_search.PROVIDER, WebSearchFeature.FACT_CHECK, succeeded=False)
        _claim_failed(claim.id, SEARCH_FAILED_REASON)
        return
    save_web_search(user_id, job_id, web_search.PROVIDER, WebSearchFeature.FACT_CHECK, succeeded=True)
    if not pages:
        _claim_checked(claim.id, Verdict.NO_RELIABLE_SOURCE, NOTHING_FOUND_EXPLANATION, [], None)
        return
    try:
        judgement = judge_claim(claim.claim, pages, model=model,
                                meter=UsageMeter(user_id, job_id, LlmFeature.FACT_CHECK))
    except JudgeFormatError:
        logger.warning("claim %s of job %s: the judgement was not valid", claim.id, job_id, exc_info=True)
        _claim_failed(claim.id, JUDGE_FAILED_REASON)
        return
    except LlmError as exc:
        _claim_failed(claim.id, str(exc))
        return
    _claim_checked(claim.id, judgement.verdict, judgement.explanation, judgement.sources, model)


def _still_checking(claim_id: uuid.UUID, job_id: uuid.UUID) -> Claim | None:
    with new_session() as session:
        claim = session.scalar(select(Claim).where(Claim.id == claim_id, Claim.job_id == job_id))
        return claim if claim is not None and claim.checking_since is not None else None


def _claim_checked(claim_id: uuid.UUID, verdict: str, explanation: str, sources: list[dict],
                   model: ChatModel | None) -> None:
    with new_session() as session:
        claim = session.get(Claim, claim_id)
        if claim is None:
            return
        claim.verdict, claim.explanation, claim.sources = verdict, explanation, sources
        claim.check_model_provider, claim.check_model = (model.provider, model.model) if model else (None, None)
        claim.checked_at, claim.checking_since, claim.check_error = datetime.now(timezone.utc), None, None
        session.commit()


def _claim_failed(claim_id: uuid.UUID, reason: str) -> None:
    try:
        with new_session() as session:
            claim = session.get(Claim, claim_id)
            if claim is not None:
                claim.checking_since, claim.check_error = None, reason
                session.commit()
    except Exception:
        # Can't even record the failure: it stays 查核中 and reads as failed after CHECK_STUCK_AFTER.
        logger.exception("could not mark claim %s as failed", claim_id)


def _queue(publish: Callable[..., None], *args) -> None:
    # Runs inside the user's request: short timeouts, one connection attempt, publisher confirms (as quizzes.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish(channel, *args)
    finally:
        connection.close()


def process_fact_check_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 fact_check.requested { jobId, userId }：讀目前的逐字稿，用要求者的預設模型標出主張，完成才換掉上一次的（查核過的
    保留）。用平台模型時先檢查每月上限。格式不對是永久性失敗；暫時性失敗且還有重試預算時 raise RetryableMessageError；其他失敗設成
    「失敗」並附原因（之前的主張都保留）。"""
    payload = json.loads(body)
    job_id, user_id = uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    try:
        if not _still_generating(job_id):
            logger.info("claims of job %s are no longer being found, dropping the request", job_id)
            return
        model = resolve_chat_model(user_id)
        if not platform_tokens_left(user_id, model):
            _fail(job_id, LIMIT_REASON)
            return
        transcript = transcript_client.get_transcript(str(job_id))
        found = extract_claims(transcript, model=model, meter=UsageMeter(user_id, job_id, LlmFeature.FACT_CHECK))
        _save(job_id, found, transcript.revision, model)
    except ClaimFormatError as exc:
        logger.warning("claims of job %s: the model's reply was not valid: %s", job_id, exc)
        _fail(job_id, FORMAT_REASON)
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"fact check {job_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("finding the claims of job %s failed", job_id)
        _fail(job_id, str(exc) if isinstance(exc, LlmError) else "標出主張失敗，請再試一次")
        return
    logger.info("found %d claims in job %s at revision %s", len(found), job_id, transcript.revision)


def _still_generating(job_id: uuid.UUID) -> bool:
    with new_session() as session:
        fact_check = session.scalar(select(FactCheck).where(FactCheck.job_id == job_id))
        return fact_check is not None and fact_check.status == FactCheckStatus.GENERATING


def _save(job_id: uuid.UUID, found: list[ExtractedClaim], source_revision: int, model: ChatModel) -> None:
    with new_session() as session:
        fact_check = session.scalar(select(FactCheck).where(FactCheck.job_id == job_id).with_for_update())
        if fact_check is None:
            return
        session.execute(delete(Claim).where(
            Claim.job_id == job_id, Claim.verdict.is_(None) | Claim.verdict.not_in(_CHECKED)))
        # A checked claim holds its segment: a new one found there is the same claim again.
        held = {float(t) for t in session.scalars(select(Claim.start_time).where(Claim.job_id == job_id))}
        session.add_all([
            Claim(job_id=job_id, speaker_label=c.speaker_label, start_time=c.start_time, text=c.text, claim=c.claim,
                  kind=c.kind, verdict=None if c.checkable else Verdict.NOT_CHECKABLE, source_revision=source_revision)
            for c in found if c.start_time not in held])
        fact_check.status, fact_check.failure_reason = FactCheckStatus.COMPLETED, None
        fact_check.source_revision, fact_check.model_provider, fact_check.model = (
            source_revision, model.provider, model.model)
        fact_check.completed_at = datetime.now(timezone.utc)
        session.commit()


def _fail(job_id: uuid.UUID, reason: str) -> None:
    try:
        with new_session() as session:
            fact_check = session.scalar(select(FactCheck).where(FactCheck.job_id == job_id))
            if fact_check is not None:
                fact_check.status, fact_check.failure_reason = FactCheckStatus.FAILED, reason
                session.commit()
    except Exception:
        # Can't even record the failure: it stays GENERATING and reads as failed after STUCK_AFTER.
        logger.exception("could not mark finding the claims of job %s as failed", job_id)
