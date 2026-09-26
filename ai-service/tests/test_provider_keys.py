"""自有金鑰（見 CONTEXT.md「自有金鑰」）的存入、替換、刪除與列出：gRPC 服務連真的 Postgres，廠商的驗證 API 在 HTTP
層用假的（httpx2.MockTransport）。"""

import uuid

import grpc
import pytest
from sqlalchemy import text

from app.proto_gen import ai_pb2
from app.services import key_encryption, provider_keys

USER = str(uuid.UUID("00000000-0000-0000-0000-0000000000b1"))


def save(stub, provider, key, user=USER):
    return stub.SaveProviderKey(ai_pb2.SaveProviderKeyRequest(user_id=user, provider=provider, key=key))


def listed(stub, user=USER):
    return [(k.provider, k.last4) for k in stub.ListProviderKeys(ai_pb2.ListProviderKeysRequest(user_id=user)).keys]


@pytest.mark.parametrize("provider, key, url, header, value", [
    ("openai", "sk-proj-abcd1234", "https://api.openai.com/v1/models", "Authorization", "Bearer sk-proj-abcd1234"),
    ("anthropic", "sk-ant-api03-xyz9", "https://api.anthropic.com/v1/models", "x-api-key", "sk-ant-api03-xyz9"),
    ("gemini", "AIzaSyDemo7777", "https://generativelanguage.googleapis.com/v1beta/models", "x-goog-api-key", "AIzaSyDemo7777"),
    # OpenRouter's model list is public, so it can't tell a good key from a bad one; its key endpoint can.
    ("openrouter", "sk-or-v1-feed", "https://openrouter.ai/api/v1/key", "Authorization", "Bearer sk-or-v1-feed"),
])
def test_a_key_is_checked_with_its_provider_then_saved_showing_only_its_last_four(
        ai_stub, db_session, providers, provider, key, url, header, value):
    saved = save(ai_stub, provider, f"  {key}  ")

    [request] = providers.requests
    assert (request.method, str(request.url).split("?")[0], request.headers[header]) == ("GET", url, value)
    assert (saved.provider, saved.last4) == (provider, key[-4:])
    assert listed(ai_stub) == [(provider, key[-4:])]


def test_the_key_is_stored_encrypted_and_decrypts_back(ai_stub, db_session, providers):
    save(ai_stub, "openai", "sk-proj-secret-value-1234")

    stored = bytes(db_session.execute(text("SELECT encrypted_key FROM provider_keys")).scalar_one())
    assert b"sk-proj-secret-value-1234" not in stored
    assert key_encryption.decrypt(stored, bound_to=f"{USER}:openai") == "sk-proj-secret-value-1234"


def test_an_encrypted_key_moved_to_another_user_cannot_be_decrypted(ai_stub, db_session, providers):
    save(ai_stub, "openai", "sk-proj-secret-value-1234")

    stored = bytes(db_session.execute(text("SELECT encrypted_key FROM provider_keys")).scalar_one())
    with pytest.raises(Exception):
        key_encryption.decrypt(stored, bound_to=f"{uuid.uuid4()}:openai")


def test_a_key_with_characters_no_provider_key_can_contain_is_invalid(ai_stub, db_session, providers):
    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "openai", "sk-proj-金鑰")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert providers.requests == []


def test_only_a_successful_answer_counts_as_a_valid_key(ai_stub, db_session, providers):
    providers.status = 302  # e.g. a redirect to a login page

    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "openai", "sk-proj-abcd1234")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert listed(ai_stub) == []


def test_saving_again_replaces_the_key(ai_stub, db_session, providers):
    save(ai_stub, "openai", "sk-proj-first-1111")
    save(ai_stub, "openai", "sk-proj-second-2222")

    assert listed(ai_stub) == [("openai", "2222")]


def test_a_key_the_provider_rejects_is_not_saved(ai_stub, db_session, providers):
    providers.status = 401

    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "openai", "sk-proj-wrong-0000")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert "金鑰無效" in (error.value.details() or "")
    assert listed(ai_stub) == []


def test_the_providers_own_explanation_is_passed_on(ai_stub, db_session, providers):
    # Gemini answers a bad key with a 400 whose message says what's wrong.
    providers.status = 400
    providers.body = {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.",
                                "status": "INVALID_ARGUMENT"}}

    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "gemini", "AIza-wrong")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert "API key not valid" in (error.value.details() or "")


@pytest.mark.parametrize("unreachable, status", [(True, 200), (False, 503), (False, 429)])
def test_a_provider_that_cannot_answer_right_now_leaves_nothing_saved(ai_stub, db_session, providers, unreachable, status):
    providers.unreachable, providers.status = unreachable, status

    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "anthropic", "sk-ant-api03-temp")

    assert error.value.code() == grpc.StatusCode.UNAVAILABLE
    assert listed(ai_stub) == []


@pytest.mark.parametrize("provider, key", [("mistral", "whatever"), ("openai", "   ")])
def test_an_unknown_provider_or_an_empty_key_is_invalid(ai_stub, providers, provider, key):
    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, provider, key)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert providers.requests == []


def test_without_a_master_key_keys_cannot_be_saved(ai_stub, db_session, providers, monkeypatch):
    monkeypatch.setattr(key_encryption.settings, "key_encryption_key", "")

    with pytest.raises(grpc.RpcError) as error:
        save(ai_stub, "openai", "sk-proj-abcd1234")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION
    assert listed(ai_stub) == []


def test_a_key_can_be_deleted(ai_stub, db_session, providers):
    save(ai_stub, "openai", "sk-proj-abcd1234")

    response = ai_stub.DeleteProviderKey(ai_pb2.DeleteProviderKeyRequest(user_id=USER, provider="openai"))

    assert response.deleted is True
    assert listed(ai_stub) == []


def test_deleting_a_key_that_is_not_there_is_not_an_error(ai_stub, db_session):
    response = ai_stub.DeleteProviderKey(ai_pb2.DeleteProviderKeyRequest(user_id=USER, provider="openai"))

    assert response.deleted is False


def test_each_user_sees_only_their_own_keys(ai_stub, db_session, providers):
    save(ai_stub, "openai", "sk-proj-abcd1234")

    assert listed(ai_stub, user=str(uuid.uuid4())) == []


def test_a_malformed_user_id_is_invalid(ai_stub):
    with pytest.raises(grpc.RpcError) as error:
        ai_stub.ListProviderKeys(ai_pb2.ListProviderKeysRequest(user_id="nope"))

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
