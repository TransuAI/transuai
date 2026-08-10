import logging
import uuid
from typing import NoReturn

import grpc

from app.db import new_session
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.repositories.summary_repository import find_by_job_id

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
            summary = find_by_job_id(session, job_id)
            if summary is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "summary not found")

            return ai_pb2.Summary(
                job_id=str(summary.job_id),
                summary_text=summary.summary_text or "",
            )
        finally:
            session.close()
