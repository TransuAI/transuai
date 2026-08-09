import logging
import uuid

import grpc

from app.db import new_session
from app.proto_gen import transcription_pb2, transcription_pb2_grpc
from app.repositories.transcript_repository import find_by_job_id

logger = logging.getLogger(__name__)


class TranscriptController(transcription_pb2_grpc.TranscriptionServiceServicer):
    def GetTranscript(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            transcript = find_by_job_id(session, job_id)
            if transcript is None:
                context.abort(grpc.StatusCode.NOT_FOUND, "transcript not found")

            return transcription_pb2.Transcript(
                job_id=str(transcript.job_id),
                language=transcript.language or "",
                full_text=transcript.full_text or "",
                segments=[
                    transcription_pb2.TranscriptSegment(
                        start_time=float(seg.start_time),
                        end_time=float(seg.end_time),
                        speaker_label=seg.speaker_label or "",
                        text=seg.text,
                    )
                    for seg in transcript.segments
                ],
            )
        finally:
            session.close()
