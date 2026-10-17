"""預設模型（見 CONTEXT.md）：可以選哪些模型、設定與讀取，以及背景工作與問答要用哪個模型呼叫（需要時解開自有金鑰）。"""

import uuid

from cryptography.exceptions import InvalidTag

from app.core.config import settings
from app.db import new_session
from app.repositories.default_model_repository import delete_default_model, find_default_model, upsert_default_model
from app.repositories.provider_key_repository import delete_provider_key, find_provider_key, list_provider_keys
from app.services.key_encryption import EncryptionUnavailable, decrypt, key_binding
from app.services.llm_client import PLATFORM, ChatModel, LlmError, LlmErrorReason, platform_chat_model
from app.services.model_catalog import CURATED_MODELS, OPENROUTER, ModelChoice, UnknownModel, curated_model, openrouter_model
from app.services.providers import PROVIDERS
from app.services import system_settings


class NoProviderKey(Exception):
    """要用某個廠商的模型，但使用者沒有這個廠商的自有金鑰。"""


class ModelNotAvailable(Exception):
    """問答臨時指定的模型這位使用者用不到。"""


def platform_choice() -> ModelChoice:
    return ModelChoice(PLATFORM, system_settings.current().platform_model, supports_tools=False)


def available_models(user_id: uuid.UUID) -> tuple[list[ModelChoice], bool]:
    """平台模型，加上有自有金鑰的每個廠商整理好的清單；第二個值是能不能自己輸入 OpenRouter 模型 ID。"""
    session = new_session()
    try:
        providers = {key.provider for key in list_provider_keys(session, user_id)}
    finally:
        session.close()
    choices = [platform_choice()]
    for provider, models in CURATED_MODELS.items():
        if provider in providers:
            choices.extend(models)
    return choices, OPENROUTER in providers


def get_default_model(user_id: uuid.UUID) -> ModelChoice:
    session = new_session()
    try:
        row = find_default_model(session, user_id)
        return ModelChoice(row.provider, row.model, row.supports_tools) if row else platform_choice()
    finally:
        session.close()


def set_default_model(user_id: uuid.UUID, provider: str, model: str) -> ModelChoice:
    """選平台模型就是刪掉這一筆。其他廠商要有自有金鑰，模型要在清單上（OpenRouter 則要真的存在）。不會重新產生任何
    既有的內容。"""
    session = new_session()
    try:
        if provider == PLATFORM:
            delete_default_model(session, user_id)
            session.commit()
            return platform_choice()
        if provider not in PROVIDERS:
            raise UnknownModel(f"不支援的廠商：{provider}")
        if find_provider_key(session, user_id, provider) is None:
            raise NoProviderKey(provider)
        model = model.strip()
        choice = openrouter_model(model) if provider == OPENROUTER else curated_model(provider, model)
        upsert_default_model(session, user_id, choice.provider, choice.model, choice.supports_tools)
        session.commit()
        return choice
    finally:
        session.close()


def remove_provider_key(user_id: uuid.UUID, provider: str) -> tuple[bool, bool]:
    """刪除自有金鑰；預設模型正在用它時一起改回平台模型。回傳（有沒有刪到、預設模型有沒有被改回）。"""
    session = new_session()
    try:
        deleted = delete_provider_key(session, user_id, provider)
        reset = delete_default_model(session, user_id, provider=provider)
        session.commit()
        return deleted, reset
    finally:
        session.close()


def resolve_chat_model(user_id: uuid.UUID | None) -> ChatModel:
    """這位使用者的預設模型與他的自有金鑰（背景工作與問答都用它）；沒有選過（或不知道是誰）就是平台模型。選了自有金鑰的
    模型卻用不了時直接失敗（LlmError），絕不改用平台模型。"""
    if user_id is None:
        return platform_chat_model()
    session = new_session()
    try:
        row = find_default_model(session, user_id)
        key = find_provider_key(session, user_id, row.provider) if row else None
    finally:
        session.close()
    if row is None:
        return platform_chat_model()
    if key is None:
        # 刪金鑰時會一起改回平台模型，照理不會發生；真的發生也不改用平台模型（使用者選了自己的廠商）。
        raise LlmError(row.provider, row.model, LlmErrorReason.AUTH, "找不到這個廠商的自有金鑰，請到設定頁重新存入或改選模型")
    return _own_key_model(user_id, row.provider, row.model, key.encrypted_key)


def resolve_requested_chat_model(user_id: uuid.UUID, provider: str, model: str) -> ChatModel:
    """問答臨時指定的模型（只用在那一次提問）：平台模型、有自有金鑰的廠商整理好的清單，或這位使用者目前的預設模型
    （OpenRouter 的模型只有選成預設時確認過存在）。用不到時 raise ModelNotAvailable。"""
    if provider == PLATFORM:
        return platform_chat_model()
    session = new_session()
    try:
        key = find_provider_key(session, user_id, provider)
        default = find_default_model(session, user_id)
    finally:
        session.close()
    is_default = default is not None and (default.provider, default.model) == (provider, model)
    if key is None or not (is_default or _is_curated(provider, model)):
        raise ModelNotAvailable(f"不能用 {provider} 的「{model}」")
    return _own_key_model(user_id, provider, model, key.encrypted_key)


def _is_curated(provider: str, model: str) -> bool:
    return any(choice.model == model for choice in CURATED_MODELS.get(provider, []))


def _own_key_model(user_id: uuid.UUID, provider: str, model: str, encrypted_key: bytes) -> ChatModel:
    try:
        api_key = decrypt(encrypted_key, bound_to=key_binding(user_id, provider))
    except EncryptionUnavailable as exc:
        raise LlmError(provider, model, LlmErrorReason.OTHER, "伺服器沒有設定加密金鑰，暫時無法使用自有金鑰") from exc
    except InvalidTag as exc:
        # 主金鑰換過、或密文被動過：這把金鑰解不開了。
        raise LlmError(provider, model, LlmErrorReason.AUTH, "無法解開儲存的金鑰，請到設定頁重新存入") from exc
    return ChatModel(provider=provider, model=model, base_url=PROVIDERS[provider].base_url, api_key=api_key)
