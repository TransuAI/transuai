"""多格式輸出怎麼跑（產生本身見 output_generator.py）：要求時建立一份「產生中」並排入 ai-service 自己的 output.requested queue，背景依
這個 Job 的摘要、章節與講者用要求者的預設模型寫，完成時存成 Markdown。同一個 Job 可以有很多份。做法照測驗（quizzes.py）。"""

import json
import logging
import uuid
from datetime import datetime, timezone

from pika import BlockingConnection
from sqlalchemy import select

from app.db import new_session
from app.models import GeneratedOutput, OutputStatus
from app.repositories.chapter_repository import find_by_job_id as find_chapters
from app.repositories.summary_repository import find_by_job_id as find_summary
from app.services.default_models import resolve_chat_model
from app.services.event_publisher import connection_params, publish_output_requested
from app.services.llm_client import ChatModel, LlmError
from app.services.output_generator import FORMATS, SOCIAL_PLATFORMS, OutputFormatError, OutputSource, generate_output
from app.services.regeneration import STUCK_AFTER
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.speaker_context import speaker_names
from app.services.transcript_client import transcript_client
from app.services.usage_meter import LlmFeature, UsageMeter

logger = logging.getLogger(__name__)

STUCK_REASON = "產生逾時，請再產生一次"
MAX_INSTRUCTION_CHARS = 200
MAX_CONTENT_CHARS = 20000


class InvalidOutputRequest(Exception):
    """Unknown format, an instruction that's too long, or a social post without a known platform."""


class InvalidContent(Exception):
    """Empty, or longer than MAX_CONTENT_CHARS."""


class OutputNotFound(Exception):
    pass


class OutputNotEditable(Exception):
    """Still being generated, or failed: there's nothing to change yet."""


class OutputNotQueued(Exception):
    """The request couldn't be put on the queue; nothing was created."""


def effective_status(output: GeneratedOutput, now: datetime | None = None) -> tuple[OutputStatus, str | None]:
    """「產生中」超過 STUCK_AFTER 的當成失敗（例如服務中途重啟），使用者才能再產生。"""
    now = now or datetime.now(timezone.utc)
    if output.status == OutputStatus.GENERATING and now - output.requested_at >= STUCK_AFTER:
        return OutputStatus.FAILED, STUCK_REASON
    return OutputStatus(output.status), output.failure_reason


def request_output(job_id: uuid.UUID, user_id: uuid.UUID, format_name: str, *, title: str = "",
                   instruction: str = "", platform: str = "") -> GeneratedOutput:
    """建立一份「產生中」的輸出並排入 queue，立即回傳。社群貼文要有認得的平台，其他格式忽略平台。排入失敗時把它刪掉
    （raise OutputNotQueued）。"""
    instruction = instruction.strip()
    if format_name not in FORMATS or len(instruction) > MAX_INSTRUCTION_CHARS:
        raise InvalidOutputRequest()
    if format_name == "social_post" and platform not in SOCIAL_PLATFORMS:
        raise InvalidOutputRequest()
    options = ({"title": title.strip()} | ({"instruction": instruction} if instruction else {})
               | ({"platform": platform} if format_name == "social_post" else {}))
    with new_session() as session:
        output = GeneratedOutput(job_id=job_id, user_id=user_id, format=format_name, options=options,
                                 status=OutputStatus.GENERATING, requested_at=datetime.now(timezone.utc))
        session.add(output)
        session.commit()
        try:
            _queue(str(output.id), str(job_id), str(user_id))
        except Exception as exc:
            logger.exception("could not queue an output for job %s", job_id)
            session.delete(output)
            session.commit()
            raise OutputNotQueued() from exc
        return output


def list_outputs(job_id: uuid.UUID) -> list[GeneratedOutput]:
    """新的在前。"""
    with new_session() as session:
        return list(session.scalars(select(GeneratedOutput).where(GeneratedOutput.job_id == job_id)
                                    .order_by(GeneratedOutput.requested_at.desc())))


def find_output(job_id: uuid.UUID, output_id: uuid.UUID) -> GeneratedOutput | None:
    with new_session() as session:
        return session.scalar(select(GeneratedOutput).where(GeneratedOutput.job_id == job_id,
                                                            GeneratedOutput.id == output_id))


def update_content(job_id: uuid.UUID, output_id: uuid.UUID, content: str) -> GeneratedOutput:
    """使用者修改一份完成的輸出。內容跟原本一樣就不算修改（edited_at 不變）。"""
    if not content.strip() or len(content) > MAX_CONTENT_CHARS:
        raise InvalidContent()
    with new_session() as session:
        output = session.scalar(select(GeneratedOutput).where(GeneratedOutput.job_id == job_id,
                                                              GeneratedOutput.id == output_id).with_for_update())
        if output is None:
            raise OutputNotFound()
        if effective_status(output)[0] != OutputStatus.COMPLETED:
            raise OutputNotEditable()
        if content != output.content:
            output.content, output.edited_at = content, datetime.now(timezone.utc)
            session.commit()
        return output


def _queue(output_id: str, job_id: str, user_id: str) -> None:
    # Runs inside the user's request: short timeouts, one connection attempt, publisher confirms (as quizzes.py).
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        channel.confirm_delivery()
        publish_output_requested(channel, output_id, job_id, user_id)
    finally:
        connection.close()


def process_output_requested(body: bytes, retry_count: int = 0) -> None:
    """處理一則 output.requested { outputId, jobId, userId }：讀摘要、章節、逐字稿目前的講者與 revision，用要求者的預設模型寫，存成
    「完成」。還沒有摘要、模型回空的是永久性失敗；暫時性失敗且還有重試預算時 raise RetryableMessageError；其他失敗設成「失敗」並附原因。"""
    payload = json.loads(body)
    output_id, job_id, user_id = uuid.UUID(payload["outputId"]), uuid.UUID(payload["jobId"]), uuid.UUID(payload["userId"])
    try:
        output = _still_generating(output_id)
        if output is None:
            logger.info("output %s is gone or no longer being generated, dropping its request", output_id)
            return
        with new_session() as session:
            summary = find_summary(session, job_id)
            chapters = [(chapter.title, float(chapter.start_time)) for chapter in find_chapters(session, job_id)]
        if summary is None or not summary.summary_text:
            _fail(output_id, "這個 Job 還沒有摘要，無法產生")
            return
        transcript = transcript_client.get_transcript(str(job_id))
        names = speaker_names(transcript)
        source = OutputSource(
            title=output.options.get("title", ""), summary=summary.summary_text, chapters=chapters,
            speakers=_named_speakers(transcript) if names else [],
            instruction=output.options.get("instruction", ""))
        model = resolve_chat_model(user_id)
        content = generate_output(output.format, source, model=model, platform=output.options.get("platform"),
                                  meter=UsageMeter(user_id, job_id, LlmFeature.GENERATED_OUTPUT))
        _save(output_id, content, transcript.revision, model)
    except OutputFormatError:
        _fail(output_id, "模型沒有回傳內容，請再產生一次")
        return
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"output {output_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("generating output %s of job %s failed", output_id, job_id)
        _fail(output_id, str(exc) if isinstance(exc, LlmError) else "產生失敗，請再試一次")
        return
    logger.info("generated output %s of job %s", output_id, job_id)


def _named_speakers(transcript) -> list[str]:
    """使用者取過名字的講者（依顯示順序）；還叫「講者 N」的沒有資訊，不給模型（否則會寫出「講者 1 至講者 9 參與討論」）。"""
    return [s.display_name for s in sorted(transcript.speakers, key=lambda s: s.display_order)
            if s.display_name != f"講者 {s.display_order}"]


def _still_generating(output_id: uuid.UUID) -> GeneratedOutput | None:
    with new_session() as session:
        output = session.get(GeneratedOutput, output_id)
        return output if output and output.status == OutputStatus.GENERATING else None


def _save(output_id: uuid.UUID, content: str, source_revision: int, model: ChatModel) -> None:
    with new_session() as session:
        output = session.get(GeneratedOutput, output_id, with_for_update=True)
        if output is None or output.status != OutputStatus.GENERATING:
            return
        output.content, output.status, output.failure_reason = content, OutputStatus.COMPLETED, None
        output.source_revision, output.model_provider, output.model = source_revision, model.provider, model.model
        output.completed_at = datetime.now(timezone.utc)
        session.commit()


def _fail(output_id: uuid.UUID, reason: str) -> None:
    try:
        with new_session() as session:
            output = session.get(GeneratedOutput, output_id)
            if output is not None:
                output.status, output.failure_reason = OutputStatus.FAILED, reason
                session.commit()
    except Exception:
        # Can't even record the failure: it stays GENERATING and reads as failed after STUCK_AFTER.
        logger.exception("could not mark output %s as failed", output_id)
