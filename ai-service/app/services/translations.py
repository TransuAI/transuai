"""翻譯逐字稿怎麼跑（翻譯本身見 translator.py）：要求時把這個 Job 這種語言的譯文改成「翻譯中」並排入 ai-service 自己的
translation.requested queue；背景依片段一批一批翻，**每批翻完就存**（前端輪詢看得到進度、看得到前面已經翻好的）。

每個片段的譯文記著翻的時候的原文：還沒翻的、原文跟記著的不一樣的才要翻——所以重試或中斷之後再跑，只翻剩下的；之後逐字稿被編輯，
同一個比對就知道哪幾段要重翻（follow_transcript_edit）。被清空或不存在的片段，譯文刪掉。"""

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
from app.services.platform_quota import LIMIT_REASON as PLATFORM_LIMIT_REASON, platform_tokens_left
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
LIMIT_REASON = f"{PLATFORM_LIMIT_REASON}（已經翻好的保留）"
# 翻完再讀一次逐字稿，翻的時候被編輯的片段也補翻（編輯後自動重翻不動翻譯中的，見 follow_transcript_edit）；最多這幾輪。
MAX_PASSES = 3


class UnknownLanguage(Exception):
    pass


class TranslationNotQueued(Exception):
    """The request couldn't be put on the queue; nothing changed."""


class TranslationGone(Exception):
    """The translation was deleted while it was being made."""


class _PlatformLimitReached(Exception):
    pass


@dataclass(frozen=True)
class TranslationProgress:
    translation: Translation
    translated_segments: int


def effective_status(translation: Translation, now: datetime | None = None) -> tuple[TranslationStatus, str | None]:
    """「翻譯中」超過 STUCK_AFTER 沒有進展（從要求或上一批存檔起算）的當成失敗，使用者才能再翻譯一次。"""
    now = now or datetime.now(timezone.utc)
    last_progress = max(translation.requested_at, translation.progressed_at or translation.requested_at)
    if translation.status == TranslationStatus.GENERATING and now - last_progress >= STUCK_AFTER:
        return TranslationStatus.FAILED, STUCK_REASON
    return TranslationStatus(translation.status), translation.failure_reason


def request_translation(job_id: uuid.UUID, user_id: uuid.UUID, language: str) -> Translation:
    """把這個 Job 這種語言的譯文改成「翻譯中」並排入 queue，立即回傳。已經在翻（還沒卡住）就直接回傳它；翻好的再要求一次就是把
    缺的、原文變了的補翻。排入失敗時恢復原狀（第一次就刪掉），raise TranslationNotQueued。"""
    if language not in LANGUAGES:
        raise UnknownLanguage()
    with new_session() as session:
        translation = session.scalar(_one(job_id, language)
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
        translation = session.scalar(_one(job_id, language))
        if translation is None:
            return None
        segments = list(session.scalars(select(SegmentTranslation).where(SegmentTranslation.translation_id == translation.id)))
        return TranslationProgress(translation, len(segments)), segments


def delete_translation(job_id: uuid.UUID, language: str) -> bool:
    """刪掉一種語言的譯文（片段的跟著 cascade）；沒有這種語言回 False。正在翻的那次存下一批時發現不見了就停下。"""
    with new_session() as session:
        deleted = session.execute(delete(Translation).where(Translation.job_id == job_id, Translation.language == language))
        session.commit()
        return deleted.rowcount > 0


def follow_transcript_edit(body: bytes) -> None:
    """transcript.edited { jobId } 之後（consumer 跟重算 embedding 一起呼叫）：這個 Job 的每種譯文刪掉被清空、不存在的片段的譯文；
    翻好的語言裡原文變了（或從清空還原）的片段，用最近一次要求翻譯的使用者重新排入翻譯——只翻那幾段（見 _segments_to_translate）。
    翻譯中的不動（這次編輯它可能沒跟上，下次編輯或再翻譯一次時補上）；失敗的留給使用者再翻譯一次，不自動花錢。
    沒有譯文就連逐字稿都不讀。失敗只記 log，不重試、不影響重算 embedding。"""
    job_id = None
    try:
        job_id = uuid.UUID(json.loads(body)["jobId"])
        with new_session() as session:
            existing = list(session.scalars(select(Translation).where(
                Translation.job_id == job_id, Translation.status != TranslationStatus.GENERATING)))
        if not existing:
            return
        transcript = transcript_client.get_transcript(str(job_id))
        spoken = _spoken(transcript)
        for translation in existing:
            changed = _segments_to_translate(translation.id, spoken)
            if changed and translation.status == TranslationStatus.COMPLETED:
                request_translation(job_id, translation.requested_by, translation.language)
                logger.info("transcript.edited for job %s: re-translating %d segments into %s",
                            job_id, len(changed), translation.language)
    except Exception:
        logger.exception("transcript.edited for job %s: could not bring its translations up to date", job_id)


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
    """處理一則 translation.requested { jobId, language }：讀目前的逐字稿，刪掉已經不存在、被清空、原文變了的片段的譯文，把還沒翻的
    一批一批翻、每批存檔；翻完再讀一次逐字稿，翻的時候被編輯的也補翻（最多 MAX_PASSES 輪）。一批的格式不對就切成兩半各自翻（見
    _translate），一句都翻不出來才失敗；用平台模型時每批之前檢查每月上限，到了就停（都保留已經翻好的）；暫時性失敗且還有重試預算時
    raise RetryableMessageError（再跑時從沒翻的地方接著翻）。"""
    payload = json.loads(body)
    job_id, language = uuid.UUID(payload["jobId"]), payload["language"]
    try:
        translation = _still_generating(job_id, language)
        if translation is None:
            logger.info("translation of job %s into %s is no longer being made, dropping the request", job_id, language)
            return
        model = resolve_chat_model(translation.requested_by)
        meter = UsageMeter(translation.requested_by, job_id, LlmFeature.TRANSLATION)
        for _ in range(MAX_PASSES):
            spoken = _spoken(transcript_client.get_transcript(str(job_id)))
            todo = _segments_to_translate(translation.id, spoken)
            if not todo:
                break
            _translate_in_batches(translation, spoken, todo, language, model, meter)
        _complete(translation.id, model)
    except _PlatformLimitReached:
        logger.info("translation of job %s into %s stopped: the monthly platform limit is reached", job_id, language)
        _fail(job_id, language, LIMIT_REASON)
        return
    except TranslationGone:
        logger.info("translation of job %s into %s was deleted while being made, stopping", job_id, language)
        return
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


def _translate_in_batches(translation: Translation, spoken: list, todo: list, language: str, model, meter) -> None:
    position = {s.id: i for i, s in enumerate(spoken)}
    for start in range(0, len(todo), BATCH_SIZE):
        if not platform_tokens_left(translation.requested_by, model):
            raise _PlatformLimitReached()
        batch = todo[start:start + BATCH_SIZE]
        first, last = position[batch[0].id], position[batch[-1].id]
        before = [s.text for s in spoken[max(0, first - CONTEXT_LINES):first]]
        after = [s.text for s in spoken[last + 1:last + 1 + CONTEXT_LINES]]
        translated = _translate([(s.id, s.text) for s in batch], language, before, after, model, meter)
        _save_batch(translation.id, batch, translated)


def _translate(pairs: list[tuple[str, str]], language: str, before: list[str], after: list[str], model,
               meter) -> dict[str, str]:
    """翻一批；模型回的對不上（漏了、合併了幾句）就把這批切成兩半各自翻，越切越小——到只剩一句時重試一次，還是不對才 raise
    TranslationFormatError。前半的後文是後半的開頭幾句，後半的前文是前半的最後幾句。最壞情況一批 40 句約 80 次呼叫（都記用量）。"""
    try:
        return translate_batch(pairs, language, before=before, after=after, model=model, meter=meter)
    except TranslationFormatError:
        if len(pairs) == 1:
            return translate_batch(pairs, language, before=before, after=after, model=model, meter=meter)
    middle = len(pairs) // 2
    texts = [text for _, text in pairs]
    translated = _translate(pairs[:middle], language, before, texts[middle:middle + CONTEXT_LINES], model, meter)
    return translated | _translate(pairs[middle:], language, texts[:middle][-CONTEXT_LINES:], after, model, meter)


def _one(job_id: uuid.UUID, language: str):
    return select(Translation).where(Translation.job_id == job_id, Translation.language == language)


def _spoken(transcript) -> list:
    return [s for s in spoken_segments(transcript) if s.id]


def _still_generating(job_id: uuid.UUID, language: str) -> Translation | None:
    with new_session() as session:
        translation = session.scalar(_one(job_id, language))
        return translation if translation and translation.status == TranslationStatus.GENERATING else None


def _segments_to_translate(translation_id: uuid.UUID, spoken: list) -> list:
    """記下這次要翻的片段數；刪掉已經不存在、被清空、原文變了的片段的譯文（進度只算現在還對得上的）；回傳要翻的片段（依順序）。"""
    with new_session() as session:
        translation = session.get(Translation, translation_id, with_for_update=True)
        if translation is None:
            raise TranslationGone()
        existing = {str(row.segment_id): row.source_text for row in session.scalars(
            select(SegmentTranslation).where(SegmentTranslation.translation_id == translation_id))}
        current = {s.id: s.text for s in spoken}
        outdated = [uuid.UUID(segment_id) for segment_id, source in existing.items() if current.get(segment_id) != source]
        if outdated:
            session.execute(delete(SegmentTranslation).where(SegmentTranslation.translation_id == translation_id,
                                                              SegmentTranslation.segment_id.in_(outdated)))
        translation.total_segments = len(spoken)
        session.commit()
    return [s for s in spoken if existing.get(s.id) != s.text]


def _save_batch(translation_id: uuid.UUID, batch: list, translated: dict[str, str]) -> None:
    with new_session() as session:
        # Locked so a delete in between waits for this batch (and then cascades it away) instead of the insert failing.
        translation = session.get(Translation, translation_id, with_for_update=True)
        if translation is None:
            raise TranslationGone()
        translation.progressed_at = datetime.now(timezone.utc)
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
            translation = session.scalar(_one(job_id, language))
            if translation is not None:
                translation.status, translation.failure_reason = TranslationStatus.FAILED, reason
                session.commit()
    except Exception:
        logger.exception("could not mark the translation of job %s into %s as failed", job_id, language)
