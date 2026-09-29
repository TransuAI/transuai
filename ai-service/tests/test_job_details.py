"""標題與類型（見 .scratch/job-auto-title）：pipeline 在摘要之後請模型依摘要與章節取標題、判斷類型，回寫到 upload-service。
Seam 是 process_message()：模型是假的 AI 廠商（HTTP 層），gRPC client、embedder 與資料庫是 mock。"""

import json
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import grpc

from app.services import pipeline, usage_meter

JOB_ID = str(uuid.uuid4())


class FakeSegment:
    def __init__(self, start_time: float, end_time: float, text: str):
        self.start_time = start_time
        self.end_time = end_time
        self.speaker_label = ""
        self.text = text


TRANSCRIPT = SimpleNamespace(
    full_text="", revision=0, speakers=[],
    segments=[FakeSegment(0.0, 5.0, "大家好，今天的產品週會"), FakeSegment(5.0, 9.0, "先談上傳失敗的問題")],
)


@contextmanager
def running_the_pipeline():
    """Runs one transcription.completed message; yields the mocked upload-service client (job_status_client)."""
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        yield job_status_client
        pipeline.process_message(json.dumps({"jobId": JOB_ID}).encode(), MagicMock(), MagicMock())


def answers(fake_llm, details: str) -> None:
    fake_llm.reply("產品週會討論上傳失敗與轉錄重試。")  # summary
    fake_llm.reply('[{"title": "上傳失敗", "start_time": 5.0}]')  # chapters
    fake_llm.reply(details)  # title and category


def test_the_job_gets_a_title_and_a_category_from_its_summary_before_it_completes(fake_llm):
    answers(fake_llm, '{"title": "產品週會：上傳失敗與轉錄重試", "category": "meeting"}')

    with running_the_pipeline() as job_status_client:
        pass

    prompt = fake_llm.bodies()[2]["messages"][0]["content"]
    assert "產品週會討論上傳失敗與轉錄重試。" in prompt and "上傳失敗" in prompt  # the summary and the chapter titles
    job_status_client.set_suggested_details.assert_called_once_with(JOB_ID, "產品週會：上傳失敗與轉錄重試", "meeting")
    calls = job_status_client.mock_calls
    assert calls.index(call.set_suggested_details(JOB_ID, "產品週會：上傳失敗與轉錄重試", "meeting")) \
        < calls.index(call.update_status(JOB_ID, "COMPLETED"))  # the list shows the title as soon as the job is done


def test_a_category_not_on_the_list_becomes_other(fake_llm):
    answers(fake_llm, '{"title": "動畫第一集", "category": "anime"}')

    with running_the_pipeline() as job_status_client:
        pass

    job_status_client.set_suggested_details.assert_called_once_with(JOB_ID, "動畫第一集", "other")


def test_the_title_is_tidied_shortened_and_in_traditional_chinese(fake_llm):
    answers(fake_llm, json.dumps({"title": "「产品周会：讨论上传失败的原因与转录服务的重试机制以及下一季的目标与分工安排」",
                                  "category": "meeting"}, ensure_ascii=False))

    with running_the_pipeline() as job_status_client:
        pass

    title = job_status_client.set_suggested_details.call_args.args[1]
    assert title.startswith("產品週會：討論上傳失敗")
    assert len(title) <= 40
    assert "「" not in title and "」" not in title


def test_the_answer_may_come_wrapped_in_a_code_block(fake_llm):
    answers(fake_llm, '```json\n{"title": "產品週會", "category": "meeting"}\n```')

    with running_the_pipeline() as job_status_client:
        pass

    job_status_client.set_suggested_details.assert_called_once_with(JOB_ID, "產品週會", "meeting")


def test_an_answer_that_is_not_the_expected_json_leaves_the_job_untitled_but_completed(fake_llm):
    answers(fake_llm, "這是一場產品週會")

    with running_the_pipeline() as job_status_client:
        pass

    job_status_client.set_suggested_details.assert_not_called()
    job_status_client.update_status.assert_called_with(JOB_ID, "COMPLETED")


def test_a_model_failure_leaves_the_job_untitled_but_completed(fake_llm):
    fake_llm.reply("產品週會討論上傳失敗與轉錄重試。")
    fake_llm.reply('[{"title": "上傳失敗", "start_time": 5.0}]')
    fake_llm.fail(400)

    with running_the_pipeline() as job_status_client:
        pass

    job_status_client.set_suggested_details.assert_not_called()
    job_status_client.update_status.assert_called_with(JOB_ID, "COMPLETED")


def test_failing_to_write_the_title_back_leaves_the_job_completed(fake_llm):
    answers(fake_llm, '{"title": "產品週會", "category": "meeting"}')

    with running_the_pipeline() as job_status_client:
        job_status_client.set_suggested_details.side_effect = grpc.RpcError()

    job_status_client.update_status.assert_called_with(JOB_ID, "COMPLETED")


def test_the_call_is_recorded_as_the_titles_usage(fake_llm):
    answers(fake_llm, '{"title": "產品週會", "category": "meeting"}')

    with patch.object(usage_meter, "save_llm_usage") as save_llm_usage, running_the_pipeline():
        pass

    assert [c.args[0].feature for c in save_llm_usage.call_args_list] == ["summary", "chapters", "job_title"]
