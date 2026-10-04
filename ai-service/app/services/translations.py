"""翻譯逐字稿怎麼跑（翻譯本身見 translator.py）：要求時把這個 Job 這種語言的譯文改成「翻譯中」並排入 ai-service 自己的
translation.requested queue；背景依片段一批一批翻，**每批翻完就存**（前端輪詢看得到進度、看得到前面已經翻好的）。

每個片段的譯文記著翻的時候的原文：還沒翻的、原文跟記著的不一樣的才要翻——所以重試或中斷之後再跑，只翻剩下的；之後逐字稿被編輯，
同一個比對就知道哪幾段要重翻。被清空或不存在的片段，譯文刪掉。"""

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pika import BlockingConnection
from sqlalchemy import delete, func, select

from app.db import new_session
from app.models import SegmentTranslation, Translation, TranslationStatus
from app.services.default_models import resolve_chat_model
from app.services.event_publisher import connection_params, publish_translation_requested
from app.services.llm_client import LlmError
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.speaker_context import spoken_segments
from app.services.transcript_client import transcript_client
from app.services.translator import LANGUAGES, TranslationFormatError, translate_batch
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

BATCH_SIZE = 40
CONTEXT_LINES = 3
# 一份長的逐字稿要翻很多批（400 個片段約 10 批），比測驗久得多。
STUCK_AFTER = timedelta(minutes=30)
STUCK_REASON = "翻譯逾時，請再翻譯一次（已經翻好的不會重翻）"
FORMAT_REASON = "模型回傳的翻譯格式不正確，請再翻譯一次（已經翻好的不會重翻）"


class UnknownLanguage(Exception):
    pass


class TranslationNotQueued(Exception):
    """The request couldn't be put on the queue; nothing changed."""


@dataclass(frozen=True)
class TranslationProgress:
    translation: Translation
    translated_segments: int


def effective_status(translation: Translation, now: datetime | None = None) -> tuple[TranslationStatus, str | None]:
    now = now or datetime.now(timezone.utc)
    if translation.status == TranslationStatus.GENERATING and now - translation.requested_at >= STUCK_AFTER:
        return TranslationStatus.FAILED, STUCK_REASON
    return TranslationStatus(translation.status), translation.failure_reason


def request_translation(job_id: uuid.UUID, user_id: uuid.UUID, language: str) -> Translation:
    """把這個 Job 這種語言的譯文改成「翻譯中」並排入 queue，立即回傳。已經在翻（還沒卡住）就直接回傳它；翻好的再要求一次就是把
    缺的、原文變了的補翻。排入失敗時恢復原狀（第一次就刪掉），raise TranslationNotQueued。"""
    if language not in LANGUAGES:
        raise UnknownLanguage()
    with new_session() as session:
        translation = session.scalar(select(Translation).where(Translation.job_id == job_id, Translation.language == language)
                                     .with_for_update())
        if translation is not None and effective_status(translation)[0] == TranslationStatus.GENERATING:
            return translation
        before = None if translation is None else (
            translation.status, translation.failure_reason, translation.requested_at, translation.requested_by)
        if translation is None:
            translation = Translation(job_id=job_id, language=language)
            session.add(translation)
        translation.requested_by, translation.status, translation.failure_reason = (
            user_id, TranslationStatus.GENERATING, None)
        translation.requested_at = datetime.now(timezone.utc)
        session.commit()
        try:
            queue_translation(str(job_id), language)
        except Exception as exc:
            logger.exception("could not queue a translation of job %s into %s", job_id, language)
            if before is None:
                session.delete(translation)
            else:
                translation.status, translation.failure_reason, translation.requested_at, translation.requested_by = before
            session.commit()
            raise TranslationNotQueued() from exc
        return translation


def list_translations(job_id: uuid.UUID) -> list[TranslationProgress]:
    with new_session() as session:
        rows = session.execute(
            select(Translation, func.count(SegmentTranslation.id))
            .outerjoin(SegmentTranslation, SegmentTranslation.translation_id == Translation.id)
            .where(Translation.job_id == job_id).group_by(Translation.id).order_by(Translation.requested_at)).all()
        return [TranslationProgress(translation, count) for translation, count in rows]


def find_translation(job_id: uuid.UUID, language: str) -> tuple[TranslationProgress, list[SegmentTranslation]] | None:
    with new_session() as session:
        translation = session.scalar(select(Translation).where(Translation.job_id == job_id, Translation.language == language))
        if translation is None:
            return None
        segments = list(session.scalars(select(SegmentTranslation).where(SegmentTranslation.translation_id == translation.id)))
        return TranslationProgress(translation, len(segments)), segments


def queue_translation(job_id: str, language: str) -> None:
    # Runs inside the user's request (or the edit handler): short timeouts, one attempt, publisher confirms (as quizzes.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_translation_requested(channel, job_id, language)
    finally:
        connection.close()


def process_translation_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 translation.requested { jobId, language }：讀目前的逐字稿，刪掉已經不存在或被清空的片段的譯文，把還沒翻的、原文變了的
    一批一批翻、每批存檔。一批的格式不對就切成兩半各自翻（見 _translate），一句都翻不出來才失敗（已經翻好的保留）；暫時性失敗且還有重試預算時
    raise RetryableMessageError（再跑時從沒翻的地方接著翻）。"""
    payload = json.loads(body)
    job_id, language = uuid.UUID(payload["jobId"]), payload["language"]
    try:
        translation = _still_generating(job_id, language)
        if translation is None:
            logger.info("translation of job %s into %s is no longer being made, dropping the request", job_id, language)
            return
        transcript = transcript_client.get_transcript(str(job_id))
        spoken = [s for s in spoken_segments(transcript) if s.id]
        todo = _segments_to_translate(translation.id, spoken)
        model = resolve_chat_model(translation.requested_by)
        meter = UsageMeter(translation.requested_by, job_id, LlmFeature.TRANSLATION)
        position = {s.id: i for i, s in enumerate(spoken)}
        for start in range(0, len(todo), BATCH_SIZE):
            batch = todo[start:start + BATCH_SIZE]
            first = position[batch[0].id]
            context = [s.text for s in spoken[max(0, first - CONTEXT_LINES):first]]
            pairs = [(s.id, s.text) for s in batch]
            translated = _translate(pairs, language, context, model, meter)
            _save_batch(translation.id, batch, translated)
        _complete(translation.id, model)
    except TranslationFormatError as exc:
        logger.warning("translation of job %s into %s: the model's reply didn't match the batch twice: %s", job_id, language, exc)
        _fail(job_id, language, FORMAT_REASON)
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"translation {job_id}/{language}: transient failure, retry_count={retry_count}") from exc
        logger.exception("translating job %s into %s failed", job_id, language)
        _fail(job_id, language, str(exc) if isinstance(exc, LlmError) else "翻譯失敗，請再試一次（已經翻好的不會重翻）")
        return
    logger.info("translated job %s into %s", job_id, language)


def _translate(pairs: list[tuple[str, str]], language: str, context: list[str], model, meter) -> dict[str, str]:
    """翻一批；模型回的對不上（漏了、合併了幾句）就把這批切成兩半各自翻，越切越小——到只剩一句時重試一次，還是不對才 raise
    TranslationFormatError。後半的上下文是前半的最後幾句。"""
    try:
        return translate_batch(pairs, language, context=context, model=model, meter=meter)
    except TranslationFormatError:
        if len(pairs) == 1:
            return translate_batch(pairs, language, context=context, model=model, meter=meter)
    middle = len(pairs) // 2
    first, second = pairs[:middle], pairs[middle:]
    translated = _translate(first, language, context, model, meter)
    return translated | _translate(second, language, [text for _, text in first][-CONTEXT_LINES:], model, meter)


def _still_generating(job_id: uuid.UUID, language: str) -> Translation | None:
    with new_session() as session:
        translation = session.scalar(select(Translation).where(Translation.job_id == job_id, Translation.language == language))
        return translation if translation and translation.status == TranslationStatus.GENERATING else None


def _segments_to_translate(translation_id: uuid.UUID, spoken: list) -> list:
    """記下這次要翻的片段數；刪掉已經不存在或被清空的片段的譯文；回傳還沒翻的、原文變了的片段（依順序）。"""
    with new_session() as session:
        existing = {str(row.segment_id): row.source_text for row in session.scalars(
            select(SegmentTranslation).where(SegmentTranslation.translation_id == translation_id))}
        current = {s.id for s in spoken}
        gone = [uuid.UUID(segment_id) for segment_id in existing if segment_id not in current]
        if gone:
            session.execute(delete(SegmentTranslation).where(SegmentTranslation.translation_id == translation_id,
                                                              SegmentTranslation.segment_id.in_(gone)))
        session.get(Translation, translation_id).total_segments = len(spoken)
        session.commit()
    return [s for s in spoken if existing.get(s.id) != s.text]


def _save_batch(translation_id: uuid.UUID, batch: list, translated: dict[str, str]) -> None:
    with new_session() as session:
        ids = [uuid.UUID(s.id) for s in batch]
        session.execute(delete(SegmentTranslation).where(SegmentTranslation.translation_id == translation_id,
                                                          SegmentTranslation.segment_id.in_(ids)))
        session.add_all([SegmentTranslation(translation_id=translation_id, segment_id=uuid.UUID(s.id), source_text=s.text,
                                            text=translated[s.id]) for s in batch])
        session.commit()


def _complete(translation_id: uuid.UUID, model) -> None:
    with new_session() as session:
        translation = session.get(Translation, translation_id)
        if translation is None:
            return
        translation.status, translation.failure_reason = TranslationStatus.COMPLETED, None
        translation.model_provider, translation.model = model.provider, model.model
        translation.completed_at = datetime.now(timezone.utc)
        session.commit()


def _fail(job_id: uuid.UUID, language: str, reason: str) -> None:
    try:
        with new_session() as session:
            translation = session.scalar(select(Translation).where(Translation.job_id == job_id, Translation.language == language))
            if translation is not None:
                translation.status, translation.failure_reason = TranslationStatus.FAILED, reason
                session.commit()
    except Exception:
        logger.exception("could not mark the translation of job %s into %s as failed", job_id, language)
