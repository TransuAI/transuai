"""JobAccess 問 upload-service 的 GetJob：帶 x-user-id，NOT_FOUND／INVALID_ARGUMENT 是「不是你的」，其他錯誤是暫時問不到。"""

import asyncio
import uuid

import grpc
import pytest

from app.proto_gen import upload_pb2, upload_pb2_grpc
from app.services.job_access import JobAccess, JobAccessUnavailable

OWNER = str(uuid.uuid4())
JOB = str(uuid.uuid4())


class FakeUploadService(upload_pb2_grpc.UploadServiceServicer):
    def __init__(self, failure: grpc.StatusCode | None = None) -> None:
        self.failure = failure

    async def GetJob(self, request, context):
        if self.failure is not None:
            await context.abort(self.failure, "fake failure")
        user_id = dict(context.invocation_metadata()).get("x-user-id")
        if request.job_id != JOB or user_id != OWNER:
            await context.abort(grpc.StatusCode.NOT_FOUND, "job not found")
        return upload_pb2.Job(job_id=JOB, user_id=OWNER)


def ask(user_id: str, job_id: str, failure: grpc.StatusCode | None = None) -> bool:
    async def run() -> bool:
        server = grpc.aio.server()
        upload_pb2_grpc.add_UploadServiceServicer_to_server(FakeUploadService(failure), server)
        port = server.add_insecure_port("127.0.0.1:0")
        await server.start()
        try:
            return await JobAccess(f"127.0.0.1:{port}", timeout_seconds=5).owns(user_id, job_id)
        finally:
            await server.stop(None)

    return asyncio.run(run())


def test_the_owner_owns_the_job():
    assert ask(OWNER, JOB)


def test_someone_else_does_not():
    assert not ask(str(uuid.uuid4()), JOB)


def test_an_invalid_job_id_is_not_owned():
    assert not ask(OWNER, "not-a-uuid", failure=grpc.StatusCode.INVALID_ARGUMENT)


@pytest.mark.parametrize("failure", [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED, grpc.StatusCode.INTERNAL])
def test_other_failures_mean_try_again_later(failure):
    with pytest.raises(JobAccessUnavailable):
        ask(OWNER, JOB, failure=failure)
