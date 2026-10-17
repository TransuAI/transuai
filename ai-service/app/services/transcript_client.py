import logging

import grpc

from app.core.config import settings
from app.proto_gen import transcription_pb2, transcription_pb2_grpc

logger = logging.getLogger(__name__)


class TranscriptClient:
    """呼叫 Transcription Service 的 TranscriptionService.GetTranscript 取得逐字稿全文。

    服務對服務呼叫，不需要 x-user-id，只信任內部網路呼叫（跟 transcription-service
    呼叫 upload-service 的 InternalJobService 是同一種模式）。
    """

    def __init__(self, target: str = settings.transcription_service_grpc_target):
        self._channel = grpc.insecure_channel(target)
        self._stub = transcription_pb2_grpc.TranscriptionServiceStub(self._channel)

    def get_transcript(self, job_id: str, timeout: float | None = None) -> transcription_pb2.Transcript:
        request = transcription_pb2.GetTranscriptRequest(job_id=job_id)
        return self._stub.GetTranscript(request, timeout=timeout)

    def close(self) -> None:
        self._channel.close()


transcript_client = TranscriptClient()
