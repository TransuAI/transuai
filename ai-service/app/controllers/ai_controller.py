import logging
import uuid
from typing import NoReturn

import grpc
from google.protobuf import timestamp_pb2

from app.db import new_session
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.repositories.chapter_repository import find_by_job_id as find_chapters_by_job_id
from app.repositories.llm_usage_repository import list_job_llm_usage
from app.repositories.qa_repository import find_by_job_id as find_qa_history_by_job_id
from app.repositories.qa_repository import save_qa
from app.repositories.summary_repository import find_by_job_id as find_summary_by_job_id
from app.services.qa import NoEmbeddingsError, stream_answer
from app.models import RegenerationStatus
from app.services.regeneration import (
    RegenerationNotQueued,
    SummaryNotFound,
    effective_regeneration_status,
    request_regeneration,
)

logger = logging.getLogger(__name__)

_STREAM_ERROR_MESSAGE = "回答時發生錯誤，請稍後再試"


def _abort(context: grpc.ServicerContext, code: grpc.StatusCode, message: str) -> NoReturn:
    context.abort(code, message)
    raise AssertionError("unreachable")  # context.abort() 保證會 raise 中斷 RPC


_REGENERATION_STATUSES = {
    RegenerationStatus.IDLE: ai_pb2.REGENERATION_STATUS_IDLE,
    RegenerationStatus.RUNNING: ai_pb2.REGENERATION_STATUS_RUNNING,
    RegenerationStatus.FAILED: ai_pb2.REGENERATION_STATUS_FAILED,
}


def _summary_to_proto(summary) -> ai_pb2.Summary:
    return ai_pb2.Summary(
        job_id=str(summary.job_id),
        summary_text=summary.summary_text or "",
        source_revision=summary.source_revision,
        regeneration_status=_REGENERATION_STATUSES[effective_regeneration_status(summary)],
    )


class AiController(ai_pb2_grpc.AiServiceServicer):
    def GetSummary(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            summary = find_summary_by_job_id(session, job_id)
            if summary is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "summary not found")

            return _summary_to_proto(summary)
        finally:
            session.close()

    def ListChapters(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            chapters = find_chapters_by_job_id(session, job_id)
            return ai_pb2.ListChaptersResponse(
                chapters=[
                    ai_pb2.Chapter(
                        id=str(chapter.id),
                        job_id=str(chapter.job_id),
                        title=chapter.title,
                        start_time=float(chapter.start_time),
                        sequence_no=chapter.sequence_no,
                    )
                    for chapter in chapters
                ]
            )
        finally:
            session.close()

    def AskQuestion(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")
        try:
            user_id = uuid.UUID(request.user_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "user_id must be a valid UUID")

        question = request.question.strip()
        if not question:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "question must not be empty")

        session = new_session()
        try:
            chunks = stream_answer(session, job_id, question, user_id=user_id)

            # 第一個 yield 保證是 sources（見 qa.stream_answer），在這之前發生的任何錯誤都還
            # 沒有送出任何 chunk：NoEmbeddingsError 是結構性的（這個 job 現在就是沒有 embedding），
            # 維持跟之前一樣的 NOT_FOUND abort；其他例外（改寫/檢索呼叫失敗）視為這輪問答本身
            # 失敗，改用 error chunk 讓 stream 正常結束，不寫 qa_history。
            try:
                kind, source_timestamps = next(chunks)
            except NoEmbeddingsError:
                _abort(context, grpc.StatusCode.NOT_FOUND,
                       "no transcript content available for this job yet")
            except Exception:
                logger.exception("failed to prepare answer for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_STREAM_ERROR_MESSAGE)
                return
            assert kind == "sources"
            yield ai_pb2.AskQuestionChunk(
                sources=ai_pb2.SourceTimestamps(source_timestamps=source_timestamps))

            answer_parts: list[str] = []
            try:
                for _, delta in chunks:
                    answer_parts.append(delta)
                    yield ai_pb2.AskQuestionChunk(delta=delta)
            except Exception:
                logger.exception("answer streaming failed mid-flight for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_STREAM_ERROR_MESSAGE)
                return

            save_qa(session, job_id, user_id, question, "".join(answer_parts), source_timestamps)
        finally:
            session.close()

    def ListQaHistory(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            turns = []
            for turn in find_qa_history_by_job_id(session, job_id):
                created_at = timestamp_pb2.Timestamp()
                created_at.FromDatetime(turn.created_at)
                turns.append(ai_pb2.QaTurn(
                    question=turn.question,
                    answer=turn.answer,
                    source_timestamps=[float(t) for t in turn.source_timestamps],
                    created_at=created_at,
                ))
            return ai_pb2.ListQaHistoryResponse(turns=turns)
        finally:
            session.close()

    def RequestRegeneration(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")
        # 升級前的 Gateway 不帶 user_id：照樣排入，用量不記使用者。
        try:
            user_id = uuid.UUID(request.user_id) if request.user_id else None
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "user_id must be a valid UUID")
        try:
            summary = request_regeneration(job_id, user_id)
        except SummaryNotFound:
            _abort(context, grpc.StatusCode.NOT_FOUND, "summary not found")
        except RegenerationNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "could not queue the regeneration, try again")
        return _summary_to_proto(summary)

    def ListJobLlmUsage(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            return ai_pb2.ListJobLlmUsageResponse(
                records=[_llm_usage_to_proto(usage) for usage in list_job_llm_usage(session, job_id)])
        finally:
            session.close()


def _llm_usage_to_proto(usage) -> ai_pb2.LlmUsage:
    created_at = timestamp_pb2.Timestamp()
    created_at.FromDatetime(usage.created_at)
    record = ai_pb2.LlmUsage(
        feature=usage.feature, provider=usage.provider, model=usage.model, key_source=usage.key_source,
        succeeded=usage.succeeded, created_at=created_at)
    # 未知的 token 數不設定欄位（proto3 optional），跟 0 分得開。
    if usage.input_tokens is not None:
        record.input_tokens = usage.input_tokens
    if usage.output_tokens is not None:
        record.output_tokens = usage.output_tokens
    return record
