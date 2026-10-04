"""多格式輸出怎麼跑（.scratch/multi-format-outputs/issues/01）：gRPC 要求、列出、取得（真的 Postgres，RabbitMQ 換成記錄發了什麼的
假的），以及背景產生——直接呼叫處理 output.requested 的函式，模型是假的 AI 廠商，逐字稿 client mock 掉。"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import select, update

from app.db import new_session
from app.models import GeneratedOutput, LlmUsage
from app.proto_gen import ai_pb2
from app.repositories.chapter_repository import save_chapters
from app.repositories.summary_repository import save_summary
from app.services import generated_outputs, job_deletion
from app.services.retry import RetryableMessageError

USER = uuid.UUID("00000000-0000-0000-0000-0000000000f0")
TRANSCRIPT = SimpleNamespace(full_text="", revision=2, language="zh-TW", segments=[
    SimpleNamespace(start_time=0, end_time=3, speaker_label="S1", text="歡迎收聽"),
    SimpleNamespace(start_time=3, end_time=6, speaker_label="S2", text="大家好"),
], speakers=[SimpleNamespace(label="S1", display_name="主持人", display_order=1),
             SimpleNamespace(label="S2", display_name="小明", display_order=2)])


@pytest.fixture
def rabbitmq():
    with patch("app.services.generated_outputs.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield channel


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request(stub, job_id, format_name="podcast_description", instruction="", title="產品週會", platform=""):
    return stub.RequestOutput(ai_pb2.RequestOutputRequest(
        job_id=str(job_id), user_id=str(USER), format=format_name, title=title, instruction=instruction, platform=platform))


def summarized_job():
    job_id = uuid.uuid4()
    with new_session() as session:
        save_summary(session, job_id, "討論了下一季的預算。", source_revision=2, model=("platform", "qwen"))
        save_chapters(session, job_id, [("開場", 0.0), ("預算", 65.0)])
    return job_id


def process(output, transcript=TRANSCRIPT, retry_count=0):
    with patch.object(generated_outputs, "transcript_client") as client:
        client.get_transcript.return_value = transcript
        generated_outputs.process_output_requested(
            json.dumps({"outputId": output.id, "jobId": output.job_id, "userId": str(USER)}).encode(),
            retry_count=retry_count)


def test_requesting_creates_one_being_generated_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    output = request(ai_stub, job_id, instruction="  語氣輕鬆一點 ")

    assert (output.format, output.status, output.instruction) == (
        "podcast_description", ai_pb2.OUTPUT_STATUS_GENERATING, "語氣輕鬆一點")
    assert published(rabbitmq) == [("output.requested", {"outputId": output.id, "jobId": str(job_id), "userId": str(USER)})]


@pytest.mark.parametrize("format_name, instruction", [("press_release", ""), ("podcast_description", "很" * 201)])
def test_an_unknown_format_or_a_too_long_instruction_is_invalid(ai_stub, db_session, rabbitmq, format_name, instruction):
    with pytest.raises(grpc.RpcError) as error:
        request(ai_stub, uuid.uuid4(), format_name, instruction)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert published(rabbitmq) == []


@pytest.mark.parametrize("platform", ["", "myspace"])
def test_a_social_post_needs_a_known_platform(ai_stub, db_session, rabbitmq, platform):
    with pytest.raises(grpc.RpcError) as error:
        request(ai_stub, uuid.uuid4(), "social_post", platform=platform)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_social_post_is_written_for_its_platform(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = summarized_job()
    output = request(ai_stub, job_id, "social_post", platform="linkedin")
    assert output.platform == "linkedin"
    fake_llm.reply("貼文")

    process(output)

    assert "LinkedIn" in fake_llm.bodies()[0]["messages"][0]["content"]
    assert ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=str(job_id), output_id=output.id)).content == "貼文\n"


def test_other_formats_ignore_a_platform(ai_stub, db_session, rabbitmq):
    assert request(ai_stub, uuid.uuid4(), "blog_post", platform="x").platform == ""


def test_generating_writes_the_document_from_the_summary_chapters_and_speakers(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = summarized_job()
    output = request(ai_stub, job_id, instruction="給工程師看")
    fake_llm.reply("這一集聊預算。")

    process(output)

    done = ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=str(job_id), output_id=output.id))
    assert done.status == ai_pb2.OUTPUT_STATUS_COMPLETED
    assert done.content == "這一集聊預算。\n\n## 章節\n\n00:00 開場\n01:05 預算\n"
    assert done.source_revision == 2 and done.model
    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "標題：產品週會" in prompt and "講者：主持人、小明" in prompt and "給工程師看" in prompt
    with new_session() as session:
        assert [u.feature for u in session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id))] == ["generated_output"]


def test_speakers_still_called_by_their_number_are_left_out_of_the_prompt(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = summarized_job()
    output = request(ai_stub, job_id)
    fake_llm.reply("介紹")
    unnamed = SimpleNamespace(**{**vars(TRANSCRIPT), "speakers": [
        SimpleNamespace(label="S1", display_name="主持人", display_order=1),
        SimpleNamespace(label="S2", display_name="講者 2", display_order=2)]})

    process(output, transcript=unnamed)

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "講者：主持人\n" in prompt and "講者 2" not in prompt


def test_an_english_recording_is_written_up_in_english(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = summarized_job()
    output = request(ai_stub, job_id)
    fake_llm.reply("An episode about the budget.")

    process(output, transcript=SimpleNamespace(**{**vars(TRANSCRIPT), "language": "en"}))

    assert "請用 English 寫" in fake_llm.bodies()[0]["messages"][0]["content"]


def test_each_request_is_another_output_listed_newest_first(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    first = request(ai_stub, job_id)
    second = request(ai_stub, job_id)
    request(ai_stub, uuid.uuid4())  # another job's

    listed = ai_stub.ListOutputs(ai_pb2.ListOutputsRequest(job_id=str(job_id))).outputs
    assert [o.id for o in listed] == [second.id, first.id]


def test_a_job_without_a_summary_fails_with_a_reason(ai_stub, db_session, rabbitmq, fake_llm):
    output = request(ai_stub, uuid.uuid4())

    process(output)

    failed = ai_stub.ListOutputs(ai_pb2.ListOutputsRequest(job_id=output.job_id)).outputs[0]
    assert (failed.status, failed.failure_reason) == (ai_pb2.OUTPUT_STATUS_FAILED, "這個 Job 還沒有摘要，無法產生")
    assert fake_llm.bodies() == []


def test_an_empty_reply_fails_and_a_passing_failure_is_retried(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = summarized_job()
    empty, flaky = request(ai_stub, job_id), request(ai_stub, job_id)

    fake_llm.reply("")
    process(empty)
    fake_llm.fail(503)
    with pytest.raises(RetryableMessageError):
        process(flaky)

    outputs = {o.id: o for o in ai_stub.ListOutputs(ai_pb2.ListOutputsRequest(job_id=str(job_id))).outputs}
    assert outputs[empty.id].failure_reason == "模型沒有回傳內容，請再產生一次"
    assert outputs[flaky.id].status == ai_pb2.OUTPUT_STATUS_GENERATING


def test_one_stuck_too_long_reads_as_failed(ai_stub, db_session, rabbitmq):
    output = request(ai_stub, uuid.uuid4())
    with new_session() as session:
        session.execute(update(GeneratedOutput).values(requested_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        session.commit()

    got = ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=output.job_id, output_id=output.id))
    assert got.status == ai_pb2.OUTPUT_STATUS_FAILED


def test_another_jobs_output_is_not_found(ai_stub, db_session, rabbitmq):
    output = request(ai_stub, uuid.uuid4())

    with pytest.raises(grpc.RpcError) as error:
        ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=str(uuid.uuid4()), output_id=output.id))
    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_a_message_that_cannot_be_queued_creates_nothing(ai_stub, db_session, rabbitmq):
    rabbitmq.basic_publish.side_effect = RuntimeError("broker down")
    job_id = uuid.uuid4()

    with pytest.raises(grpc.RpcError) as error:
        request(ai_stub, job_id)

    assert error.value.code() == grpc.StatusCode.UNAVAILABLE
    assert list(ai_stub.ListOutputs(ai_pb2.ListOutputsRequest(job_id=str(job_id))).outputs) == []


def test_deleting_the_job_deletes_its_outputs(ai_stub, db_session, rabbitmq):
    output = request(ai_stub, uuid.uuid4())

    job_deletion.delete_job_data(uuid.UUID(output.job_id))

    assert list(ai_stub.ListOutputs(ai_pb2.ListOutputsRequest(job_id=output.job_id)).outputs) == []


# --- 03：使用者修改內容 ---


def completed(ai_stub, fake_llm):
    job_id = summarized_job()
    output = request(ai_stub, job_id)
    fake_llm.reply("原本的介紹")
    process(output)
    return job_id, output


def change_content(stub, job_id, output_id, content):
    return stub.UpdateOutput(ai_pb2.UpdateOutputRequest(job_id=str(job_id), output_id=output_id, content=content))


def test_the_user_can_change_a_finished_output_and_it_is_marked_edited(ai_stub, db_session, rabbitmq, fake_llm):
    job_id, output = completed(ai_stub, fake_llm)

    updated = change_content(ai_stub, job_id, output.id, "我改過的介紹\n")

    assert updated.content == "我改過的介紹\n"
    assert updated.HasField("edited_at")
    assert ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=str(job_id), output_id=output.id)).content == "我改過的介紹\n"


def test_saving_the_same_content_does_not_mark_it_edited(ai_stub, db_session, rabbitmq, fake_llm):
    job_id, output = completed(ai_stub, fake_llm)
    original = ai_stub.GetOutput(ai_pb2.GetOutputRequest(job_id=str(job_id), output_id=output.id)).content

    assert not change_content(ai_stub, job_id, output.id, original).HasField("edited_at")


@pytest.mark.parametrize("content", ["", "   \n", "很" * 20001])
def test_empty_or_too_long_content_is_invalid(ai_stub, db_session, rabbitmq, fake_llm, content):
    job_id, output = completed(ai_stub, fake_llm)

    with pytest.raises(grpc.RpcError) as error:
        change_content(ai_stub, job_id, output.id, content)
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_an_output_still_being_generated_cannot_be_changed(ai_stub, db_session, rabbitmq):
    output = request(ai_stub, uuid.uuid4())

    with pytest.raises(grpc.RpcError) as error:
        change_content(ai_stub, output.job_id, output.id, "太早了")
    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION


def test_changing_another_jobs_output_is_not_found(ai_stub, db_session, rabbitmq, fake_llm):
    _, output = completed(ai_stub, fake_llm)

    with pytest.raises(grpc.RpcError) as error:
        change_content(ai_stub, uuid.uuid4(), output.id, "偷改")
    assert error.value.code() == grpc.StatusCode.NOT_FOUND
