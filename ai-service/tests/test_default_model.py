"""預設模型（見 CONTEXT.md「預設模型」）：可以選哪些模型、設定與讀取、刪除金鑰時改回平台模型（gRPC 服務，連真的
Postgres），以及背景工作真的用 Job 擁有者的預設模型與自有金鑰呼叫（假的 AI 廠商，HTTP 層）。"""

import json
import uuid
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import text

from app.proto_gen import ai_pb2
from app.repositories.llm_usage_repository import LlmUsageRecord
from app.services import pipeline, regeneration, usage_meter
from app.services.retry import RetryableMessageError

USER = str(uuid.UUID("00000000-0000-0000-0000-0000000000c1"))


def save_key(stub, provider, key, user=USER):
    stub.SaveProviderKey(ai_pb2.SaveProviderKeyRequest(user_id=user, provider=provider, key=key))


def default_model(stub, user=USER):
    choice = stub.GetDefaultModel(ai_pb2.GetDefaultModelRequest(user_id=user))
    return choice.provider, choice.model


def set_default(stub, provider, model, user=USER):
    return stub.SetDefaultModel(ai_pb2.SetDefaultModelRequest(user_id=user, provider=provider, model=model))


def available(stub, user=USER):
    response = stub.ListAvailableModels(ai_pb2.ListAvailableModelsRequest(user_id=user))
    return [(m.provider, m.model) for m in response.models], response.openrouter_custom


# --- 選擇與設定 ---


def test_without_a_choice_the_default_is_the_platform_model(ai_stub, db_session):
    assert default_model(ai_stub) == ("platform", "Qwen/Qwen3.5-9B")


def test_without_keys_only_the_platform_model_is_available(ai_stub, db_session):
    assert available(ai_stub) == ([("platform", "Qwen/Qwen3.5-9B")], False)


def test_each_saved_key_makes_its_providers_models_available(ai_stub, db_session, providers):
    save_key(ai_stub, "openai", "sk-proj-abcd1234")
    save_key(ai_stub, "openrouter", "sk-or-v1-feed")

    models, openrouter_custom = available(ai_stub)

    assert models[0] == ("platform", "Qwen/Qwen3.5-9B")
    assert ("openai", "gpt-5-mini") in models
    assert all(provider in ("platform", "openai") for provider, _ in models)
    assert openrouter_custom is True


def test_a_model_from_a_provider_with_a_key_can_be_the_default(ai_stub, db_session, providers):
    save_key(ai_stub, "openai", "sk-proj-abcd1234")

    choice = set_default(ai_stub, "openai", "gpt-5-mini")

    assert (choice.provider, choice.model, choice.supports_tools) == ("openai", "gpt-5-mini", True)
    assert default_model(ai_stub) == ("openai", "gpt-5-mini")


def test_the_platform_model_can_be_chosen_again(ai_stub, db_session, providers):
    save_key(ai_stub, "openai", "sk-proj-abcd1234")
    set_default(ai_stub, "openai", "gpt-5-mini")

    set_default(ai_stub, "platform", "")

    assert default_model(ai_stub) == ("platform", "Qwen/Qwen3.5-9B")


def test_a_provider_without_a_key_cannot_be_the_default(ai_stub, db_session):
    with pytest.raises(grpc.RpcError) as error:
        set_default(ai_stub, "anthropic", "claude-sonnet-5")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION


def test_a_model_outside_the_providers_list_is_invalid(ai_stub, db_session, providers):
    save_key(ai_stub, "openai", "sk-proj-abcd1234")

    with pytest.raises(grpc.RpcError) as error:
        set_default(ai_stub, "openai", "gpt-made-up")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_any_openrouter_model_that_exists_can_be_the_default(ai_stub, db_session, providers):
    save_key(ai_stub, "openrouter", "sk-or-v1-feed")
    providers.openrouter_models = [
        {"id": "typesafe/jev-router", "supported_parameters": []},
        {"id": "deepseek/deepseek-chat", "supported_parameters": ["tools", "temperature"]},
    ]

    router = set_default(ai_stub, "openrouter", "typesafe/jev-router")
    deepseek = set_default(ai_stub, "openrouter", " deepseek/deepseek-chat ")

    assert (router.model, router.supports_tools) == ("typesafe/jev-router", False)
    assert (deepseek.model, deepseek.supports_tools) == ("deepseek/deepseek-chat", True)


def test_an_openrouter_model_that_does_not_exist_is_invalid(ai_stub, db_session, providers):
    save_key(ai_stub, "openrouter", "sk-or-v1-feed")
    providers.openrouter_models = [{"id": "deepseek/deepseek-chat", "supported_parameters": []}]

    with pytest.raises(grpc.RpcError) as error:
        set_default(ai_stub, "openrouter", "deepseek/deepseek-chatt")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_deleting_the_key_the_default_model_uses_brings_back_the_platform_model(ai_stub, db_session, providers):
    save_key(ai_stub, "openai", "sk-proj-abcd1234")
    save_key(ai_stub, "anthropic", "sk-ant-api03-xyz9")
    set_default(ai_stub, "openai", "gpt-5-mini")

    other = ai_stub.DeleteProviderKey(ai_pb2.DeleteProviderKeyRequest(user_id=USER, provider="anthropic"))
    used = ai_stub.DeleteProviderKey(ai_pb2.DeleteProviderKeyRequest(user_id=USER, provider="openai"))

    assert (other.deleted, other.default_model_reset) == (True, False)
    assert (used.deleted, used.default_model_reset) == (True, True)
    assert default_model(ai_stub) == ("platform", "Qwen/Qwen3.5-9B")


# --- 背景工作用 Job 擁有者的預設模型 ---


class FakeSegment:
    def __init__(self, start: float, text: str):
        self.start_time, self.end_time, self.text, self.speaker_label = start, start + 2, text, ""


TRANSCRIPT = MagicMock(full_text="大家好\n今天談預算", revision=1, speakers=[],
                       segments=[FakeSegment(0.0, "大家好"), FakeSegment(2.0, "今天談預算")])


@pytest.fixture
def saved_usage():
    records: list[LlmUsageRecord] = []
    with patch.object(usage_meter, "save_llm_usage", side_effect=records.append):
        yield records


def run_pipeline(user_id: str | None = USER, retry_count: int = 0):
    payload = {"jobId": str(uuid.uuid4())} | ({"userId": user_id} if user_id else {})
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", return_value=[[0.1], [0.2]]),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary") as save_summary,
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        pipeline.process_message(json.dumps(payload).encode(), MagicMock(), MagicMock(), retry_count=retry_count)
    return job_status_client, save_summary


def test_the_summary_is_made_with_the_owners_default_model_and_key(
        ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    fake_llm.reply("摘要")
    fake_llm.reply("[]")

    _, save_summary = run_pipeline()

    summary_request = fake_llm.requests[0]
    assert str(summary_request.url) == "https://api.openai.com/v1/chat/completions"
    assert summary_request.headers["Authorization"] == "Bearer sk-proj-owner-key-1234"
    assert fake_llm.bodies()[0]["model"] == "gpt-5-mini"
    assert "chat_template_kwargs" not in fake_llm.bodies()[0]  # that's only for the platform model
    assert save_summary.call_args.kwargs["model"] == ("openai", "gpt-5-mini")
    # The summary, the chapters and the title (test_job_details.py), all with the owner's own key.
    assert [(r.provider, r.model, r.key_source) for r in saved_usage] == [("openai", "gpt-5-mini", "own_key")] * 3


def test_an_owner_without_a_choice_gets_the_platform_model(ai_stub, db_session, fake_llm, saved_usage):
    fake_llm.reply("摘要")
    fake_llm.reply("[]")

    _, save_summary = run_pipeline()

    assert str(fake_llm.requests[0].url) == "https://router.huggingface.co/v1/chat/completions"
    assert save_summary.call_args.kwargs["model"] == ("platform", "Qwen/Qwen3.5-9B")


def test_a_rejected_own_key_fails_the_job_saying_why_without_retrying_or_falling_back(
        ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    fake_llm.fail(401, {"message": "Incorrect API key provided"})

    job_status_client, _ = run_pipeline()

    status_call = job_status_client.update_status.call_args
    assert status_call.args[1] == "FAILED"
    assert "openai" in status_call.kwargs["error_reason"] and "金鑰無效" in status_call.kwargs["error_reason"]
    assert [str(r.url) for r in fake_llm.requests] == ["https://api.openai.com/v1/chat/completions"]


def test_a_default_model_whose_key_is_gone_fails_instead_of_using_the_platform_model(
        ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    db_session.execute(text("DELETE FROM provider_keys"))  # e.g. removed behind the service's back
    db_session.commit()

    job_status_client, _ = run_pipeline()

    status_call = job_status_client.update_status.call_args
    assert status_call.args[1] == "FAILED"
    assert "openai" in status_call.kwargs["error_reason"]
    assert fake_llm.requests == []


def test_an_unsupported_provider_cannot_be_the_default(ai_stub, db_session):
    with pytest.raises(grpc.RpcError) as error:
        set_default(ai_stub, "mistral", "mistral-large")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_busy_provider_is_retried_with_the_own_key(ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    fake_llm.fail(429)

    with pytest.raises(RetryableMessageError):
        run_pipeline(retry_count=0)


def test_regenerating_uses_the_requesters_default_model(ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "anthropic", "sk-ant-api03-xyz9")
    set_default(ai_stub, "anthropic", "claude-sonnet-5")
    fake_llm.reply("新摘要")
    fake_llm.reply("[]")

    with (
        patch.object(regeneration, "transcript_client") as transcript_client,
        patch.object(regeneration, "new_session", return_value=MagicMock(name="session")),
        patch.object(regeneration, "replace_summary_and_chapters") as replace,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        regeneration.process_regeneration_requested(json.dumps({"jobId": str(uuid.uuid4()), "userId": USER}).encode())

    assert str(fake_llm.requests[0].url) == "https://api.anthropic.com/v1/chat/completions"
    assert fake_llm.bodies()[0]["model"] == "claude-sonnet-5"
    assert replace.call_args.kwargs["model"] == ("anthropic", "claude-sonnet-5")


def regenerate():
    with (
        patch.object(regeneration, "transcript_client") as transcript_client,
        patch.object(regeneration, "new_session", return_value=MagicMock(name="session")),
        patch.object(regeneration, "replace_summary_and_chapters") as replace,
        patch.object(regeneration, "_mark_failed") as mark_failed,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        regeneration.process_regeneration_requested(json.dumps({"jobId": str(uuid.uuid4()), "userId": USER}).encode())
    return replace, mark_failed


def test_regenerating_without_a_choice_uses_the_platform_model(ai_stub, db_session, fake_llm, saved_usage):
    fake_llm.reply("新摘要")
    fake_llm.reply("[]")

    replace, _ = regenerate()

    assert str(fake_llm.requests[0].url) == "https://router.huggingface.co/v1/chat/completions"
    assert replace.call_args.kwargs["model"] == ("platform", "Qwen/Qwen3.5-9B")


def test_a_rejected_own_key_fails_the_regeneration_without_retrying_or_falling_back(
        ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    fake_llm.fail(402)

    replace, mark_failed = regenerate()

    replace.assert_not_called()
    mark_failed.assert_called_once()
    assert [str(r.url) for r in fake_llm.requests] == ["https://api.openai.com/v1/chat/completions"]


def test_a_busy_provider_asks_for_the_regeneration_to_be_retried(ai_stub, db_session, providers, fake_llm, saved_usage):
    save_key(ai_stub, "openai", "sk-proj-owner-key-1234")
    set_default(ai_stub, "openai", "gpt-5-mini")
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        regenerate()

