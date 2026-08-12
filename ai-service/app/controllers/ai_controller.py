import logging
import uuid
from typing import NoReturn

import grpc

from app.db import new_session
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.repositories.chapter_repository import find_by_job_id as find_chapters_by_job_id
from app.repositories.qa_repository import save_qa
from app.repositories.summary_repository import find_by_job_id as find_summary_by_job_id
from app.services.qa import NoEmbeddingsError, answer_question

logger = logging.getLogger(__name__)


def _abort(context: grpc.ServicerContext, code: grpc.StatusCode, message: str) -> NoReturn:
    context.abort(code, message)
    raise AssertionError("unreachable")  # context.abort() 保證會 raise 中斷 RPC


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

            return ai_pb2.Summary(
                job_id=str(summary.job_id),
                summary_text=summary.summary_text or "",
            )
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
            try:
                answer, source_timestamps = answer_question(session, job_id, question)
            except NoEmbeddingsError:
                _abort(context, grpc.StatusCode.NOT_FOUND,
                       "no transcript content available for this job yet")

            save_qa(session, job_id, user_id, question, answer, source_timestamps)
            return ai_pb2.AskQuestionResponse(answer=answer, source_timestamps=source_timestamps)
        finally:
            session.close()
