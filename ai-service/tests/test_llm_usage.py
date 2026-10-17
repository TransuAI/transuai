"""用量（見 CONTEXT.md「用量」）：每次 LLM 呼叫都在 Job 擁有者名下記一筆。模型是假的 AI 廠商（HTTP 層），
用量的存檔在 pipeline 類的測試裡攔下來看，在 gRPC 的測試裡則真的寫進測試資料庫。"""

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest

from app.proto_gen import ai_pb2
from app.repositories.llm_usage_repository import LlmUsageRecord, save_llm_usage
from app.services import pipeline, qa, regeneration, usage_meter

OWNER = uuid.UUID("00000000-0000-0000-0000-0000000000a1")


class FakeSegment:
    def __init__(self, start: float, text: str):
        self.start_time, self.end_time, self.text, self.speaker_label = start, start + 2, text, ""


TRANSCRIPT = SimpleNamespace(
    full_text="大家好\n今天談預算", revision=1, speakers=[],
    segments=[FakeSegment(0.0, "大家好"), FakeSegment(2.0, "今天談預算")],
)


@pytest.fixture
def saved_usage():
    """Captures the usage records instead of writing them to the database."""
    records: list[LlmUsageRecord] = []
    with patch.object(usage_meter, "save_llm_usage", side_effect=lambda record: records.append(record)):
        yield records


def run_pipeline(job_id: uuid.UUID, user_id: uuid.UUID | None):
    payload = {"jobId": str(job_id)} | ({"userId": str(user_id)} if user_id else {})
    with (
        patch.object(pipeline, "job_status_client"),
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        pipeline.process_message(json.dumps(payload).encode(), MagicMock(), MagicMock())


def summary_of(record: LlmUsageRecord):
    return (record.feature, record.user_id, record.provider, record.model, record.key_source,
            record.input_tokens, record.output_tokens, record.succeeded)


def test_the_pipeline_records_the_summary_and_the_chapters_under_the_jobs_owner(fake_llm, saved_usage):
    job_id = uuid.uuid4()
    fake_llm.reply("摘要", usage=(300, 40))
    fake_llm.reply("[]", usage=(250, 5))

    run_pipeline(job_id, OWNER)

    assert [summary_of(r) for r in saved_usage] == [
        ("summary", OWNER, "platform", "Qwen/Qwen3.5-9B", "platform", 300, 40, True),
        ("chapters", OWNER, "platform", "Qwen/Qwen3.5-9B", "platform", 250, 5, True),
        ("job_title", OWNER, "platform", "Qwen/Qwen3.5-9B", "platform", 12, 5, True),  # see test_job_details.py
    ]
    assert all(r.job_id == job_id for r in saved_usage)


def test_a_message_from_before_owners_were_sent_records_usage_without_a_user(fake_llm, saved_usage):
    run_pipeline(uuid.uuid4(), None)

    assert [r.user_id for r in saved_usage] == [None, None]


def test_a_failed_call_is_recorded_as_failed_without_numbers(fake_llm, saved_usage):
    fake_llm.fail(401)

    run_pipeline(uuid.uuid4(), OWNER)

    [record] = saved_usage
    assert (record.feature, record.succeeded, record.input_tokens, record.output_tokens) == ("summary", False, None, None)


def test_usage_the_provider_did_not_report_is_recorded_as_unknown(fake_llm, saved_usage):
    fake_llm.reply("摘要", usage=None)

    run_pipeline(uuid.uuid4(), OWNER)

    assert (saved_usage[0].input_tokens, saved_usage[0].output_tokens, saved_usage[0].succeeded) == (None, None, True)


def test_a_usage_record_that_cannot_be_saved_does_not_fail_the_job(fake_llm):
    fake_llm.reply("摘要")
    fake_llm.reply("[]")
    with (
        patch.object(usage_meter, "save_llm_usage", side_effect=RuntimeError("database down")),
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        pipeline.process_message(json.dumps({"jobId": str(uuid.uuid4()), "userId": str(OWNER)}).encode(),
                                 MagicMock(), MagicMock())

    assert job_status_client.update_status.call_args.args[1] == "COMPLETED"


def test_regenerating_records_both_calls_as_regenerated_for_the_requester(fake_llm, saved_usage):
    job_id = uuid.uuid4()
    with (
        patch.object(regeneration, "transcript_client") as transcript_client,
        patch.object(regeneration, "new_session", return_value=MagicMock(name="session")),
        patch.object(regeneration, "replace_summary_and_chapters"),
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        regeneration.process_regeneration_requested(json.dumps({"jobId": str(job_id), "userId": str(OWNER)}).encode())

    assert [(r.feature, r.user_id, r.job_id) for r in saved_usage] == [
        ("regenerated_summary", OWNER, job_id), ("regenerated_chapters", OWNER, job_id)]


def test_a_question_records_the_rewrite_and_the_streamed_answer_for_the_asker(fake_llm, saved_usage):
    job_id = uuid.uuid4()
    fake_llm.reply("王小明對預算怎麼看？", usage=(90, 12))
    fake_llm.stream(["他認為要砍一成。"], usage=(400, 30))
    chunk = SimpleNamespace(start_time=2.0, end_time=4.0, chunk_text="今天談預算")

    with (
        patch.object(qa, "find_by_job_id", return_value=[SimpleNamespace(question="王小明是誰？", answer="來賓。")]),
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[chunk]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        list(qa.stream_answer(MagicMock(name="session"), job_id, "那他怎麼看？", user_id=OWNER))

    assert [(r.feature, r.user_id, r.input_tokens, r.output_tokens, r.succeeded) for r in saved_usage] == [
        ("qa_rewrite", OWNER, 90, 12, True), ("qa_answer", OWNER, 400, 30, True)]


def test_an_answer_that_fails_mid_stream_is_recorded_as_failed(fake_llm, saved_usage):
    fake_llm.stream_then_fail(["一半"], "upstream disconnected")

    with (
        patch.object(qa, "find_by_job_id", return_value=[]),
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[SimpleNamespace(start_time=0.0, end_time=2.0, chunk_text="大家好")]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        with pytest.raises(Exception):
            list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "問題", user_id=OWNER))

    assert [(r.feature, r.succeeded) for r in saved_usage] == [("qa_answer", False)]


@contextmanager
def answering(job_id):
    """stream_answer() is a generator: it only runs while being read, so the patches stay on meanwhile."""
    with (
        patch.object(qa, "find_by_job_id", return_value=[]),
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[SimpleNamespace(start_time=0.0, end_time=2.0, chunk_text="大家好")]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        yield qa.stream_answer(MagicMock(name="session"), job_id, "問題", user_id=OWNER)


def test_a_streamed_answer_without_reported_usage_is_recorded_as_unknown(fake_llm, saved_usage):
    fake_llm.stream(["好"], usage=None)

    with answering(uuid.uuid4()) as events:
        list(events)

    assert [(r.feature, r.succeeded, r.input_tokens, r.output_tokens) for r in saved_usage] == [
        ("qa_answer", True, None, None)]


def test_an_answer_abandoned_part_way_is_recorded_as_failed(fake_llm, saved_usage):
    # The browser went away: the gRPC stream stops being read before the provider finished. The first text only goes out
    # once the answer's opening is long enough to tell whether it's simplified Chinese (traditional_chinese.py).
    fake_llm.stream(["這場會議主要在談工程團隊的關鍵指標，決定把月會拆成四個部門各自的檢討，", "並且改用新的指標。", "後面還有。"])

    with answering(uuid.uuid4()) as events:
        for kind, _ in events:  # steps, sources, answered_by… up to the first text
            if kind == "delta":
                break
        events.close()

    assert [(r.feature, r.succeeded) for r in saved_usage] == [("qa_answer", False)]


def test_a_malformed_owner_in_a_message_is_treated_as_unknown(fake_llm, saved_usage):
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        fake_llm.reply("摘要")
        fake_llm.reply("[]")
        transcript_client.get_transcript.return_value = TRANSCRIPT
        pipeline.process_message(json.dumps({"jobId": str(uuid.uuid4()), "userId": "not-a-uuid"}).encode(),
                                 MagicMock(), MagicMock())

    assert job_status_client.update_status.call_args.args[1] == "COMPLETED"
    assert [r.user_id for r in saved_usage] == [None, None, None]  # the summary, the chapters and the title


# --- 查詢（真的 Postgres）---


def record(job_id, feature, input_tokens, output_tokens, *, minute, succeeded=True):
    return LlmUsageRecord(
        user_id=OWNER, job_id=job_id, feature=feature, provider="platform", model="Qwen/Qwen3.5-9B",
        key_source="platform", input_tokens=input_tokens, output_tokens=output_tokens, succeeded=succeeded,
        created_at=datetime(2026, 9, 26, 10, minute, tzinfo=timezone.utc),
    )


def test_a_jobs_usage_is_listed_oldest_first_with_unknown_numbers_left_unset(ai_stub, db_session):
    job_id, other_job = uuid.uuid4(), uuid.uuid4()
    save_llm_usage(record(job_id, "chapters", 250, 5, minute=2))
    save_llm_usage(record(job_id, "summary", 300, 40, minute=1))
    save_llm_usage(record(job_id, "qa_answer", None, None, minute=3, succeeded=False))
    save_llm_usage(record(other_job, "summary", 1, 1, minute=1))

    response = ai_stub.ListJobLlmUsage(ai_pb2.ListJobLlmUsageRequest(job_id=str(job_id)))

    assert [(r.feature, r.input_tokens, r.output_tokens, r.succeeded) for r in response.records[:2]] == [
        ("summary", 300, 40, True), ("chapters", 250, 5, True)]
    unknown = response.records[2]
    assert (unknown.feature, unknown.HasField("input_tokens"), unknown.HasField("output_tokens"), unknown.succeeded) == (
        "qa_answer", False, False, False)
    assert (response.records[0].provider, response.records[0].model, response.records[0].key_source) == (
        "platform", "Qwen/Qwen3.5-9B", "platform")


def test_listing_usage_with_a_malformed_job_id_is_invalid(ai_stub):
    with pytest.raises(grpc.RpcError) as error:
        ai_stub.ListJobLlmUsage(ai_pb2.ListJobLlmUsageRequest(job_id="not-a-uuid"))

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


# --- 一位使用者一段時間的彙總（真的 Postgres）---

SEPTEMBER = (datetime(2026, 8, 31, 16, tzinfo=timezone.utc), datetime(2026, 9, 30, 16, tzinfo=timezone.utc))


def used(at, provider, model, input_tokens, output_tokens, *, user_id=OWNER, key_source="own_key", succeeded=True):
    return LlmUsageRecord(
        user_id=user_id, job_id=uuid.uuid4(), feature="summary", provider=provider, model=model,
        key_source=key_source, input_tokens=input_tokens, output_tokens=output_tokens, succeeded=succeeded,
        created_at=at)


def sum_usage(stub, user_id: uuid.UUID | str = OWNER, start=SEPTEMBER[0], end=SEPTEMBER[1]):
    request = ai_pb2.SumUserLlmUsageRequest(user_id=str(user_id))
    request.start.FromDatetime(start)
    request.end.FromDatetime(end)
    return stub.SumUserLlmUsage(request).sums


def test_a_users_usage_over_a_period_is_summed_per_model_and_key_source(ai_stub, db_session):
    start, end = SEPTEMBER
    save_llm_usage(used(start, "openai", "gpt-5", 100, 10))
    save_llm_usage(used(start + timedelta(days=3), "openai", "gpt-5", 200, 20))
    save_llm_usage(used(start + timedelta(days=4), "openai", "gpt-5", None, None, succeeded=False))
    save_llm_usage(used(start + timedelta(days=5), "platform", "Qwen/Qwen3.5-9B", 50, 5, key_source="platform"))

    sums = sorted(sum_usage(ai_stub), key=lambda s: s.provider)

    assert [(s.provider, s.model, s.key_source, s.input_tokens, s.output_tokens, s.calls, s.calls_with_unknown_usage)
            for s in sums] == [
        ("openai", "gpt-5", "own_key", 300, 30, 3, 1),
        ("platform", "Qwen/Qwen3.5-9B", "platform", 50, 5, 1, 0),
    ]


def test_the_sum_leaves_out_other_users_and_usage_outside_the_period(ai_stub, db_session):
    start, end = SEPTEMBER
    save_llm_usage(used(start - timedelta(seconds=1), "openai", "gpt-5", 1, 1))
    save_llm_usage(used(end, "openai", "gpt-5", 2, 2))
    save_llm_usage(used(start, "openai", "gpt-5", 4, 4, user_id=uuid.uuid4()))
    save_llm_usage(used(end - timedelta(seconds=1), "openai", "gpt-5", 8, 8))

    assert [(s.input_tokens, s.calls) for s in sum_usage(ai_stub)] == [(8, 1)]


def test_a_period_without_usage_sums_to_nothing(ai_stub, db_session):
    assert list(sum_usage(ai_stub)) == []


def test_summing_usage_needs_a_valid_user_and_a_period(ai_stub):
    with pytest.raises(grpc.RpcError) as error:
        sum_usage(ai_stub, user_id="nope")
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT

    with pytest.raises(grpc.RpcError) as error:
        ai_stub.SumUserLlmUsage(ai_pb2.SumUserLlmUsageRequest(user_id=str(OWNER)))
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
