import logging

import grpc

from app.core.config import settings
from app.proto_gen import upload_pb2, upload_pb2_grpc

logger = logging.getLogger(__name__)


class JobAccessUnavailable(Exception):
    """問不到 upload-service（暫時的）：不知道 Job 是不是這位使用者的，連線先關掉，前端稍後重連。"""


class JobAccess:
    """Job 是不是這位使用者的：借用 upload-service 的 UploadService.GetJob——它本身就有 ownership 檢查，別人的 Job、刪掉的 Job、
    不合法的 id 都回 NOT_FOUND／INVALID_ARGUMENT（跟 gateway 的 JobOwnershipGuard 一樣，不在這裡重新實作比對）。"""

    def __init__(self, target: str, timeout_seconds: float) -> None:
        self._target = target
        self._timeout_seconds = timeout_seconds
        self._stub: upload_pb2_grpc.UploadServiceStub | None = None

    def _upload_service(self) -> upload_pb2_grpc.UploadServiceStub:
        # grpc.aio 的 channel 要在 uvicorn 的 event loop 裡建立，所以第一次用到才建。
        if self._stub is None:
            self._stub = upload_pb2_grpc.UploadServiceStub(grpc.aio.insecure_channel(self._target))
        return self._stub

    async def owns(self, user_id: str, job_id: str) -> bool:
        try:
            await self._upload_service().GetJob(
                upload_pb2.GetJobRequest(job_id=job_id),
                metadata=(("x-user-id", user_id),),
                timeout=self._timeout_seconds,
            )
        except grpc.aio.AioRpcError as error:
            if error.code() in (grpc.StatusCode.NOT_FOUND, grpc.StatusCode.INVALID_ARGUMENT):
                return False
            logger.warning("could not check job %s with upload-service: %s", job_id, error.code())
            raise JobAccessUnavailable() from error
        return True


job_access = JobAccess(settings.upload_service_grpc_target, settings.upload_service_timeout_seconds)
