"""系統設定的「模型」（.scratch/system-settings/issues/04）：設定頁存過就用存的、沒存過用環境變數；金鑰加密存、不回傳；存了馬上
生效；換了 embedding 模型就重算。資料庫是真的，模型伺服器是假的。"""

from unittest.mock import patch

import httpx2
import pytest
from sqlalchemy import text

from app.core import outbound
from app.proto_gen import ai_pb2
from app.services import llm_client, settings_check, system_settings


def saved(**overrides) -> system_settings.AiSettingsUpdate:
    values = dict(platform_base_url="http://gpu-box:8000/v1", platform_model="Qwen/Qwen3-8B-AWQ",
                  post_meeting_model="Qwen/Qwen3-8B-AWQ", embedding_base_url="http://gpu-box:8001/v1",
                  embedding_model="Qwen/Qwen3-Embedding-0.6B", embedding_query_instruction="find it")
    return system_settings.AiSettingsUpdate(**(values | overrides))


def test_without_saved_settings_the_environment_is_used(db_session):
    config = system_settings.current()

    assert config.from_environment
    assert (config.platform_base_url, config.platform_model) == ("https://vllm.test/v1", "Qwen/Qwen3.5-9B")


def test_saved_settings_take_effect_at_once_everywhere(db_session):
    with patch("app.services.embedding_migration.sync_embeddings"):
        system_settings.save(saved(platform_api_key="sk-local"))

    model = llm_client.platform_chat_model()
    assert (model.base_url, model.model, model.api_key) == ("http://gpu-box:8000/v1", "Qwen/Qwen3-8B-AWQ", "sk-local")
    assert {"gpu-box"} <= outbound.allowed_hosts()
    assert not system_settings.current().from_environment


def test_keys_are_stored_encrypted_and_never_sent_back(ai_stub, db_session):
    with patch("app.services.embedding_migration.sync_embeddings"):
        answer = ai_stub.UpdateAiSettings(ai_pb2.UpdateAiSettingsRequest(
            platform_base_url="http://gpu-box:8000/v1", platform_model="m", embedding_base_url="", embedding_model="",
            platform_api_key="sk-very-secret", web_search_api_key="tvly-secret"))

    assert answer.platform_api_key_set and answer.web_search_api_key_set
    assert "sk-very-secret" not in str(answer) and "tvly-secret" not in str(answer)
    stored = db_session.execute(text("SELECT platform_api_key FROM ai_settings")).scalar_one()
    assert b"sk-very-secret" not in bytes(stored)
    assert system_settings.current().platform_api_key == "sk-very-secret"


def test_a_key_left_out_is_kept_and_an_empty_one_is_cleared(db_session):
    with patch("app.services.embedding_migration.sync_embeddings"):
        system_settings.save(saved(platform_api_key="sk-1", web_search_api_key="tvly-1"))
        system_settings.save(saved())  # nothing given: keep both
        assert (system_settings.current().platform_api_key, system_settings.current().web_search_api_key) == ("sk-1", "tvly-1")
        system_settings.save(saved(web_search_api_key=""))

    assert system_settings.current().web_search_api_key == ""
    assert system_settings.current().platform_api_key == "sk-1"


def test_the_first_save_keeps_the_keys_already_set_in_the_environment(db_session):
    with patch.object(system_settings.settings, "tavily_api_key", "tvly-from-env"), \
            patch("app.services.embedding_migration.sync_embeddings"):
        system_settings.save(saved())

        assert system_settings.current().web_search_api_key == "tvly-from-env"


def test_going_back_to_the_environment(ai_stub, db_session):
    with patch("app.services.embedding_migration.sync_embeddings"):
        system_settings.save(saved())
        answer = ai_stub.UpdateAiSettings(ai_pb2.UpdateAiSettingsRequest(use_environment=True))

    assert answer.from_environment
    assert answer.platform_base_url == "https://vllm.test/v1"


def test_a_new_embedding_model_re_embeds_in_the_background(db_session):
    with patch("app.services.embedding_migration.sync_embeddings") as sync:
        system_settings.save(saved())
        sync.reset_mock()
        system_settings.save(saved(platform_model="another-chat-model"))  # chat only: no re-embedding
        assert not sync.called
        system_settings.save(saved(embedding_model="BAAI/bge-m3"))

    assert sync.called


def test_the_check_says_what_is_wrong(db_session, fake_embedder, monkeypatch):
    def served(request):
        return httpx2.Response(200, json={"data": [{"id": "Qwen/Qwen3-8B-AWQ"}]})

    monkeypatch.setattr(settings_check, "_http_client", httpx2.Client(transport=httpx2.MockTransport(served)))
    with patch("app.services.embedding_migration.sync_embeddings"):
        system_settings.save(saved())
        good = settings_check.check()
        system_settings.save(saved(platform_model="missing-model"))
        bad = settings_check.check()

    assert good.platform_ok and good.embedding_ok
    assert not bad.platform_ok and "missing-model" in bad.platform_detail and "Qwen/Qwen3-8B-AWQ" in bad.platform_detail


def test_without_a_master_key_keys_cannot_be_saved(ai_stub, db_session):
    import grpc

    with patch.object(system_settings.key_encryption.settings, "key_encryption_key", ""), \
            pytest.raises(grpc.RpcError) as raised:
        ai_stub.UpdateAiSettings(ai_pb2.UpdateAiSettingsRequest(platform_api_key="sk-1"))

    assert raised.value.code() == grpc.StatusCode.FAILED_PRECONDITION
