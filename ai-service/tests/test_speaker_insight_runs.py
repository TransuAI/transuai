"""講者數據的 AI 判斷怎麼跑（.scratch/speaker-analytics/issues/02）：gRPC 要求與取得（真的 Postgres，RabbitMQ 換成記錄發了什麼的
假的），以及背景分析——直接呼叫處理 speaker_insights.requested 的函式，模型是假的 AI 廠商，逐字稿 client mock 掉。"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select, update

from app.db import new_session
from app.models import LlmUsage, SpeakerInsightRun
from app.proto_gen import ai_pb2
from app.services import job_deletion, speaker_insight_runs
from app.services.retry import RetryableMessageError

USER = uuid.UUID("00000000-0000-0000-0000-0000000005e1")


def segment(start, end, speaker, text):
    return SimpleNamespace(start_time=start, end_time=end, speaker_label=speaker, text=text)


TRANSCRIPT = SimpleNamespace(full_text="", revision=4, segments=[
    segment(0, 4, "S1", "大家覺得預算怎麼樣"),
    segment(4.1, 8, "S2", "我覺得可以 但是"),
    segment(8.05, 10, "S1", "等一下 先聽我說"),
], speakers=[SimpleNamespace(label="S1", display_name="主持人", display_order=1),
             SimpleNamespace(label="S2", display_name="講者 2", display_order=2)])


@pytest.fixture
def rabbitmq():
    with patch("app.services.speaker_insight_runs.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield channel


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request(stub, job_id):
    return stub.RequestSpeakerInsights(ai_pb2.RequestSpeakerInsightsRequest(job_id=str(job_id), user_id=str(USER)))


def get(stub, job_id):
    return stub.GetSpeakerInsights(ai_pb2.GetSpeakerInsightsRequest(job_id=str(job_id)))


def process(job_id, transcript=TRANSCRIPT, retry_count=0):
    with patch.object(speaker_insight_runs, "transcript_client") as client:
        client.get_transcript.return_value = transcript
        speaker_insight_runs.process_speaker_insights_requested(
            json.dumps({"jobId": str(job_id), "userId": str(USER)}).encode(), retry_count=retry_count)


def test_a_job_never_analyzed_has_no_status_and_no_items(ai_stub, db_session):
    insights = get(ai_stub, uuid.uuid4())

    assert insights.status == ai_pb2.SPEAKER_INSIGHTS_STATUS_UNSPECIFIED
    assert list(insights.items) == []


def test_requesting_marks_it_being_analyzed_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    insights = request(ai_stub, job_id)

    assert insights.status == ai_pb2.SPEAKER_INSIGHTS_STATUS_GENERATING
    assert published(rabbitmq) == [("speaker_insights.requested", {"jobId": str(job_id), "userId": str(USER)})]


def test_asking_again_while_it_is_being_analyzed_queues_nothing_more(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    request(ai_stub, job_id)

    assert len(published(rabbitmq)) == 1


def test_the_analysis_saves_questions_and_interruptions_with_the_revision_and_model(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply(json.dumps({"questions": [1], "interruptions": [3]}))

    process(job_id)

    insights = get(ai_stub, job_id)
    assert insights.status == ai_pb2.SPEAKER_INSIGHTS_STATUS_COMPLETED
    assert insights.source_revision == 4 and insights.model
    assert [(i.kind, i.speaker_label, i.interrupted_label, i.text) for i in insights.items] == [
        ("question", "S1", "", "大家覺得預算怎麼樣"),
        ("interruption", "S1", "S2", "等一下 先聽我說"),
    ]
    with new_session() as session:
        usage = session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id)).all()
    assert [u.feature for u in usage] == ["speaker_insights"]


def test_analyzing_again_keeps_the_old_items_until_the_new_ones_are_done(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply(json.dumps({"questions": [1], "interruptions": []}))
    process(job_id)

    again = request(ai_stub, job_id)
    assert again.status == ai_pb2.SPEAKER_INSIGHTS_STATUS_GENERATING
    assert len(again.items) == 1

    fake_llm.reply(json.dumps({"questions": [], "interruptions": [3]}))
    process(job_id)
    assert [i.kind for i in get(ai_stub, job_id).items] == ["interruption"]


def test_a_reply_in_the_wrong_format_fails_with_a_reason(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply("不是 JSON")

    process(job_id)

    insights = get(ai_stub, job_id)
    assert insights.status == ai_pb2.SPEAKER_INSIGHTS_STATUS_FAILED
    assert insights.failure_reason == "模型回傳的格式不正確，請再分析一次"


def test_fewer_than_two_speakers_fails_without_asking_the_model(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    solo = SimpleNamespace(full_text="", revision=0, segments=[segment(0, 3, "S1", "只有我")],
                           speakers=[SimpleNamespace(label="S1", display_name="講者 1", display_order=1)])

    process(job_id, transcript=solo)

    assert get(ai_stub, job_id).failure_reason == "需要兩位以上講者才能分析"
    assert fake_llm.bodies() == []


def test_a_passing_failure_is_retried(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        process(job_id)
    assert get(ai_stub, job_id).status == ai_pb2.SPEAKER_INSIGHTS_STATUS_GENERATING


def test_an_analysis_stuck_too_long_reads_as_failed_and_can_be_asked_again(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    with new_session() as session:
        session.execute(update(SpeakerInsightRun).where(SpeakerInsightRun.job_id == job_id)
                        .values(requested_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        session.commit()

    assert get(ai_stub, job_id).status == ai_pb2.SPEAKER_INSIGHTS_STATUS_FAILED
    request(ai_stub, job_id)
    assert len(published(rabbitmq)) == 2


def test_a_message_that_cannot_be_queued_changes_nothing(ai_stub, db_session, rabbitmq):
    import grpc
    rabbitmq.basic_publish.side_effect = RuntimeError("broker down")
    job_id = uuid.uuid4()

    with pytest.raises(grpc.RpcError) as error:
        request(ai_stub, job_id)

    assert error.value.code() == grpc.StatusCode.UNAVAILABLE
    assert get(ai_stub, job_id).status == ai_pb2.SPEAKER_INSIGHTS_STATUS_UNSPECIFIED


def test_deleting_the_job_deletes_the_analysis(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply(json.dumps({"questions": [1], "interruptions": []}))
    process(job_id)

    job_deletion.delete_job_data(job_id)

    assert get(ai_stub, job_id).status == ai_pb2.SPEAKER_INSIGHTS_STATUS_UNSPECIFIED
