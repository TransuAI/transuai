import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import NamedTuple
from unittest.mock import MagicMock, patch

import grpc
import pytest
from pika.exceptions import AMQPConnectionError
from sqlalchemy import select

from app.models import Summary
from app.proto_gen import ai_pb2
from app.repositories.summary_repository import save_summary


def test_get_summary_says_which_transcript_revision_it_was_built_from(ai_stub, db_session):
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "討論了預算。", source_revision=4)

    summary = ai_stub.GetSummary(ai_pb2.GetSummaryRequest(job_id=str(job_id)))

    assert (summary.summary_text, summary.source_revision) == ("討論了預算。", 4)



class FakeRabbitMQ(NamedTuple):
    connection_class: MagicMock
    channel: MagicMock


@pytest.fixture
def rabbitmq():
    """The RabbitMQ boundary used when a regeneration is queued: records what was published."""
    with patch("app.services.regeneration.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield FakeRabbitMQ(connection_class, channel)


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


REQUESTER = uuid.UUID("00000000-0000-0000-0000-00000000a11c")


def call_request_regeneration(stub, job_id):
    return stub.RequestRegeneration(ai_pb2.RequestRegenerationRequest(job_id=str(job_id), user_id=str(REQUESTER)))


def test_requesting_a_regeneration_marks_it_running_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "舊摘要", source_revision=0)

    summary = call_request_regeneration(ai_stub, job_id)

    assert summary.regeneration_status == ai_pb2.REGENERATION_STATUS_RUNNING
    assert summary.summary_text == "舊摘要"
    assert published(rabbitmq.channel) == [
        ("summary.regeneration.requested", {"jobId": str(job_id), "userId": str(REQUESTER)})]


def test_a_second_request_while_one_is_running_is_not_queued_again(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "舊摘要", source_revision=0)

    call_request_regeneration(ai_stub, job_id)
    again = call_request_regeneration(ai_stub, job_id)

    assert again.regeneration_status == ai_pb2.REGENERATION_STATUS_RUNNING
    assert len(published(rabbitmq.channel)) == 1


def test_a_regeneration_stuck_for_more_than_5_minutes_can_be_requested_again(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    summary = save_summary(db_session, job_id, "舊摘要", source_revision=0)
    summary.regeneration_status = "RUNNING"
    summary.regeneration_requested_at = datetime.now(timezone.utc) - timedelta(minutes=6)
    db_session.commit()

    call_request_regeneration(ai_stub, job_id)

    assert len(published(rabbitmq.channel)) == 1


def test_a_job_without_a_summary_cannot_be_regenerated(ai_stub, rabbitmq):
    with pytest.raises(grpc.RpcError) as error:
        call_request_regeneration(ai_stub, uuid.uuid4())

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_if_the_request_cannot_be_queued_nothing_changes(ai_stub, db_session, rabbitmq):
    rabbitmq.connection_class.side_effect = AMQPConnectionError("broker down")
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "舊摘要", source_revision=0)

    with pytest.raises(grpc.RpcError) as error:
        call_request_regeneration(ai_stub, job_id)

    assert error.value.code() == grpc.StatusCode.UNAVAILABLE
    db_session.expire_all()
    assert db_session.scalar(select(Summary).where(Summary.job_id == job_id)).regeneration_status == "IDLE"


def test_a_regeneration_stuck_for_more_than_5_minutes_reads_as_failed_so_it_can_be_retried(ai_stub, db_session):
    job_id = uuid.uuid4()
    summary = save_summary(db_session, job_id, "舊摘要", source_revision=0)
    summary.regeneration_status = "RUNNING"
    summary.regeneration_requested_at = datetime.now(timezone.utc) - timedelta(minutes=6)
    db_session.commit()

    fetched = ai_stub.GetSummary(ai_pb2.GetSummaryRequest(job_id=str(job_id)))

    assert fetched.regeneration_status == ai_pb2.REGENERATION_STATUS_FAILED


def test_a_regeneration_requested_without_a_user_is_still_queued(ai_stub, db_session, rabbitmq):
    # A Gateway from before usage was recorded doesn't send user_id; the request must keep working.
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "舊摘要", source_revision=0)

    ai_stub.RequestRegeneration(ai_pb2.RequestRegenerationRequest(job_id=str(job_id)))

    assert published(rabbitmq.channel) == [("summary.regeneration.requested", {"jobId": str(job_id)})]

