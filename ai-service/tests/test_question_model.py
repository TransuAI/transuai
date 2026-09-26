"""問答可以臨時換模型（只影響那一次提問），每則回答記錄是哪個模型回答的。`stream_answer()` 的檢索與 transcript client
mock 掉，模型是假的 AI 廠商（HTTP 層）；金鑰與預設模型真的存在測試資料庫。"""

import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest

from app.proto_gen import ai_pb2
from app.repositories.qa_repository import save_qa
from app.services import qa, usage_meter
from app.services.default_models import ModelNotAvailable

USER = uuid.UUID("00000000-0000-0000-0000-0000000000d1")
TRANSCRIPT = SimpleNamespace(segments=[], speakers=[])


def save_key(stub, provider, key):
    stub.SaveProviderKey(ai_pb2.SaveProviderKeyRequest(user_id=str(USER), provider=provider, key=key))


@contextmanager
def asking(requested_model=None, history=()):
    with (
        patch.object(qa, "find_by_job_id", return_value=list(history)),
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[SimpleNamespace(start_time=0.0, end_time=2.0, chunk_text="大家好")]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        yield qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "預算怎麼分？", user_id=USER,
                               requested_model=requested_model)


def test_a_question_can_be_answered_by_another_model_just_this_once(ai_stub, db_session, providers, fake_llm):
    save_key(ai_stub, "openai", "sk-proj-asker-key-1234")
    fake_llm.reply("改寫後的問題")
    fake_llm.stream(["行銷砍一成。"])

    with (
        patch.object(usage_meter, "save_llm_usage") as save_llm_usage,
        asking(requested_model=("openai", "gpt-5"), history=[SimpleNamespace(question="前一題", answer="前一答")]) as events,
    ):
        events = list(events)

    assert [kind for kind, _ in events] == ["sources", "answered_by", "delta"]
    assert events[1][1] == ("openai", "gpt-5")
    # Both the rewrite and the answer go to the chosen model, with the asker's key.
    assert [str(r.url) for r in fake_llm.requests] == ["https://api.openai.com/v1/chat/completions"] * 2
    assert {body["model"] for body in fake_llm.bodies()} == {"gpt-5"}
    assert fake_llm.requests[1].headers["Authorization"] == "Bearer sk-proj-asker-key-1234"
    # Each call is recorded under the chosen model and the asker's own key.
    assert [(r.feature, r.provider, r.model, r.key_source) for r in (c.args[0] for c in save_llm_usage.call_args_list)] == [
        ("qa_rewrite", "openai", "gpt-5", "own_key"), ("qa_answer", "openai", "gpt-5", "own_key")]


def test_without_a_choice_the_default_model_answers(ai_stub, db_session, fake_llm):
    fake_llm.stream(["好。"])

    with asking() as events:
        events = list(events)

    assert events[1] == ("answered_by", ("platform", "Qwen/Qwen3.5-9B"))


def test_the_askers_default_openrouter_model_can_be_asked_for_by_name(ai_stub, db_session, providers, fake_llm):
    save_key(ai_stub, "openrouter", "sk-or-v1-feed")
    providers.openrouter_models = [{"id": "deepseek/deepseek-chat", "supported_parameters": []}]
    ai_stub.SetDefaultModel(ai_pb2.SetDefaultModelRequest(user_id=str(USER), provider="openrouter", model="deepseek/deepseek-chat"))
    fake_llm.stream(["好。"])

    with asking(requested_model=("openrouter", "deepseek/deepseek-chat")) as events:
        events = list(events)

    assert events[1] == ("answered_by", ("openrouter", "deepseek/deepseek-chat"))


@pytest.mark.parametrize("requested", [
    ("anthropic", "claude-sonnet-5"),  # no Anthropic key
    ("openai", "gpt-made-up"),  # not on the list
    ("openrouter", "some/model"),  # no OpenRouter key, and not the default
])
def test_a_model_the_asker_cannot_use_is_refused_before_anything_is_sent(
        ai_stub, db_session, providers, fake_llm, requested):
    save_key(ai_stub, "openai", "sk-proj-asker-key-1234")

    with asking(requested_model=requested) as events:
        with pytest.raises(ModelNotAvailable):
            next(events)

    assert fake_llm.requests == []


def test_asking_with_a_model_the_asker_cannot_use_is_invalid(ai_stub, db_session):
    chunks = ai_stub.AskQuestion(ai_pb2.AskQuestionRequest(
        job_id=str(uuid.uuid4()), user_id=str(USER), question="預算？",
        model=ai_pb2.ModelChoice(provider="anthropic", model="claude-sonnet-5")))

    with pytest.raises(grpc.RpcError) as error:
        next(chunks)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_the_history_says_which_model_answered_each_question(ai_stub, db_session):
    job_id = uuid.uuid4()
    save_qa(db_session, job_id, USER, "第一題", "第一答", [1.0], model=("platform", "Qwen/Qwen3.5-9B"))
    save_qa(db_session, job_id, USER, "第二題", "第二答", [2.0], model=("openai", "gpt-5"))

    turns = ai_stub.ListQaHistory(ai_pb2.ListQaHistoryRequest(job_id=str(job_id))).turns

    assert [(t.model_provider, t.model) for t in turns] == [("platform", "Qwen/Qwen3.5-9B"), ("openai", "gpt-5")]
