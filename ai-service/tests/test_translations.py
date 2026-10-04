"""翻譯逐字稿怎麼跑（.scratch/transcript-translation/issues/01）：gRPC 要求、列出、取得（真的 Postgres，RabbitMQ 換成記錄發了什麼的
假的），以及背景翻譯——直接呼叫處理 translation.requested 的函式，模型是假的 AI 廠商，逐字稿 client mock 掉。"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import select

from app.db import new_session
from app.models import LlmUsage
from app.proto_gen import ai_pb2
from app.services import job_deletion, translations
from app.services.retry import RetryableMessageError

USER = uuid.UUID("00000000-0000-0000-0000-00000000a11e")
SEG = [str(uuid.uuid4()) for _ in range(4)]


def segment(i, text, speaker="S1"):
    return SimpleNamespace(id=SEG[i], start_time=i * 2.0, end_time=i * 2.0 + 2, speaker_label=speaker, text=text)


def transcript(segments):
    return SimpleNamespace(full_text="", revision=0, language="en", segments=segments, speakers=[])


TRANSCRIPT = transcript([segment(0, "Hi."), segment(1, ""), segment(2, "Budget first."), segment(3, "Okay.")])


@pytest.fixture
def rabbitmq():
    with patch("app.services.translations.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield channel


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request(stub, job_id, language="zh-TW"):
    return stub.RequestTranslation(ai_pb2.RequestTranslationRequest(job_id=str(job_id), user_id=str(USER), language=language))


def get(stub, job_id, language="zh-TW"):
    return stub.GetTranslation(ai_pb2.GetTranslationRequest(job_id=str(job_id), language=language))


def process(job_id, the_transcript=TRANSCRIPT, language="zh-TW", retry_count=0):
    with patch.object(translations, "transcript_client") as client:
        client.get_transcript.return_value = the_transcript
        translations.process_translation_requested(
            json.dumps({"jobId": str(job_id), "language": language}).encode(), retry_count=retry_count)


def answer(fake_llm, *texts):
    fake_llm.reply(json.dumps([{"n": n, "text": t} for n, t in enumerate(texts, start=1)], ensure_ascii=False))


def test_requesting_marks_it_being_translated_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    translation = request(ai_stub, job_id)

    assert (translation.language, translation.status) == ("zh-TW", ai_pb2.TRANSLATION_STATUS_GENERATING)
    assert published(rabbitmq) == [("translation.requested", {"jobId": str(job_id), "language": "zh-TW"})]


def test_an_unknown_language_is_invalid(ai_stub, db_session, rabbitmq):
    with pytest.raises(grpc.RpcError) as error:
        request(ai_stub, uuid.uuid4(), "fr")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_every_spoken_segment_is_translated_under_its_id_and_cleared_ones_are_skipped(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, "嗨。", "先談預算。", "好。")

    process(job_id)

    done = get(ai_stub, job_id)
    assert done.status == ai_pb2.TRANSLATION_STATUS_COMPLETED
    assert (done.total_segments, done.translated_segments) == (3, 3)
    assert {s.segment_id: s.text for s in done.segments} == {SEG[0]: "嗨。", SEG[2]: "先談預算。", SEG[3]: "好。"}
    with new_session() as session:
        assert {u.feature for u in session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id))} == {"translation"}


def test_it_goes_in_batches_and_each_batch_is_saved_as_it_finishes(ai_stub, db_session, rabbitmq, fake_llm, monkeypatch):
    monkeypatch.setattr(translations, "BATCH_SIZE", 2)
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, "嗨。", "先談預算。")
    fake_llm.fail(400, {"error": {"message": "bad request"}})  # the second batch fails for good

    process(job_id)

    failed = get(ai_stub, job_id)
    assert failed.status == ai_pb2.TRANSLATION_STATUS_FAILED
    assert (failed.total_segments, failed.translated_segments) == (3, 2)  # the first batch is kept
    second_prompt = fake_llm.bodies()[1]["messages"][0]["content"]
    assert "Hi." in second_prompt and "Budget first." in second_prompt  # earlier lines as context
    assert '{"n": 1, "text": "Okay."}' in second_prompt


def test_asking_again_only_translates_what_is_missing_or_changed(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, "嗨。", "先談預算。", "好。")
    process(job_id)

    request(ai_stub, job_id)
    answer(fake_llm, "預算第二。")
    process(job_id, transcript([segment(0, "Hi."), segment(2, "Budget second."), segment(3, "Okay.")]))

    assert len(fake_llm.bodies()) == 2
    assert '{"n": 1, "text": "Budget second."}' in fake_llm.bodies()[1]["messages"][0]["content"]
    assert {s.segment_id: s.text for s in get(ai_stub, job_id).segments}[SEG[2]] == "預算第二。"


def test_a_segment_cleared_since_loses_its_translation(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, "嗨。", "先談預算。", "好。")
    process(job_id)

    request(ai_stub, job_id)
    process(job_id, transcript([segment(0, "Hi."), segment(2, ""), segment(3, "Okay.")]))

    assert SEG[2] not in {s.segment_id for s in get(ai_stub, job_id).segments}


def test_a_batch_that_comes_back_wrong_twice_fails_with_a_reason(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply("不是 JSON")
    fake_llm.reply('[{"n": 1, "text": "只有一句"}]')

    process(job_id)

    assert get(ai_stub, job_id).failure_reason == translations.FORMAT_REASON


def test_a_batch_that_comes_back_wrong_once_is_retried(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply("不是 JSON")
    answer(fake_llm, "嗨。", "先談預算。", "好。")

    process(job_id)

    assert get(ai_stub, job_id).status == ai_pb2.TRANSLATION_STATUS_COMPLETED


def test_a_passing_failure_is_retried_as_a_message(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        process(job_id)


def test_each_language_is_listed_with_its_progress(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id, "zh-TW")
    request(ai_stub, job_id, "ja")
    answer(fake_llm, "嗨。", "先談預算。", "好。")
    process(job_id, language="zh-TW")

    listed = {t.language: (t.status, t.translated_segments) for t in
              ai_stub.ListTranslations(ai_pb2.ListTranslationsRequest(job_id=str(job_id))).translations}
    assert listed == {"zh-TW": (ai_pb2.TRANSLATION_STATUS_COMPLETED, 3), "ja": (ai_pb2.TRANSLATION_STATUS_GENERATING, 0)}


def test_a_language_never_asked_for_is_not_found(ai_stub, db_session):
    with pytest.raises(grpc.RpcError) as error:
        get(ai_stub, uuid.uuid4(), "ko")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_deleting_the_job_deletes_its_translations(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, "嗨。", "先談預算。", "好。")
    process(job_id)

    job_deletion.delete_job_data(job_id)

    assert list(ai_stub.ListTranslations(ai_pb2.ListTranslationsRequest(job_id=str(job_id))).translations) == []
