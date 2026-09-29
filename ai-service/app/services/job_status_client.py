import logging

import grpc

from app.core.config import settings
from app.proto_gen import upload_pb2, upload_pb2_grpc

logger = logging.getLogger(__name__)


class JobStatusClient:
    """呼叫 Upload Service 的 InternalJobService.UpdateJobStatus 回寫 Job 狀態。

    這是服務對服務的呼叫，不帶 x-user-id（InternalJobService 本來就不需要）。
    """

    def __init__(self, target: str = settings.upload_service_grpc_target):
        self._channel = grpc.insecure_channel(target)
        self._stub = upload_pb2_grpc.InternalJobServiceStub(self._channel)

    def update_status(self, job_id: str, status: str, error_reason: str = "") -> None:
        request = upload_pb2.UpdateJobStatusRequest(
            job_id=job_id,
            status=status,
            error_reason=error_reason,
        )
        self._stub.UpdateJobStatus(request)
        logger.info("job %s status -> %s", job_id, status)

    def set_suggested_details(self, job_id: str, title: str, category: str) -> None:
        """AI 依內容建議的標題與類型（InternalJobService.SetSuggestedDetails）；使用者改過的欄位 upload-service 不會動。"""
        self._stub.SetSuggestedDetails(upload_pb2.SetSuggestedDetailsRequest(job_id=job_id, title=title, category=category))
        logger.info("job %s title and category suggested", job_id)

    def close(self) -> None:
        self._channel.close()


job_status_client = JobStatusClient()
