"""自有金鑰（見 CONTEXT.md）：存入前先向廠商驗證，通過才加密存下；之後只給看末四碼。"""

import uuid

import httpx2

from app.db import new_session
from app.models import ProviderKey
from app.repositories.provider_key_repository import upsert_provider_key
from app.services.key_encryption import encrypt, key_binding
from app.services.providers import PROVIDERS, Provider

# 驗證是使用者在等的請求：很快放棄，讓使用者稍後再試。測試會換掉它。
_http_client = httpx2.Client(timeout=httpx2.Timeout(10.0, connect=5.0))


class UnknownProvider(Exception):
    pass


class InvalidKey(Exception):
    """金鑰是空的，或廠商說它無效。訊息是給使用者看的原因。"""


class ProviderUnreachable(Exception):
    """廠商暫時沒辦法回答（逾時、連不上、429、5xx），這次沒辦法判斷金鑰對不對。"""


def save_provider_key(user_id: uuid.UUID, provider_id: str, key: str) -> ProviderKey:
    provider = PROVIDERS.get(provider_id)
    if provider is None:
        raise UnknownProvider(provider_id)
    key = key.strip()
    if not key:
        raise InvalidKey("金鑰是空的")
    # 廠商的金鑰都是可見的 ASCII 字元；其他字元多半是貼錯，而且放不進 HTTP header。
    if not key.isascii() or not key.isprintable() or " " in key:
        raise InvalidKey("金鑰含有不合法的字元，請確認有沒有貼錯")
    encrypted = encrypt(key, bound_to=key_binding(user_id, provider_id))  # 先確定能加密（有主金鑰），才去打廠商
    _check_with_provider(provider, key)

    session = new_session()
    try:
        return upsert_provider_key(session, user_id, provider_id, encrypted, key[-4:])
    finally:
        session.close()


def _check_with_provider(provider: Provider, key: str) -> None:
    provider_id = provider.id
    try:
        response = _http_client.get(provider.key_check_url, headers=provider.key_check_headers(key))
    except httpx2.TransportError as exc:
        raise ProviderUnreachable(f"{provider_id} 暫時連不上，請稍後再試") from exc
    status = response.status_code
    if status in (401, 403):
        raise InvalidKey(f"{provider_id} 回報金鑰無效或沒有權限")
    if status == 429 or status >= 500:
        raise ProviderUnreachable(f"{provider_id} 暫時無法驗證金鑰（HTTP {status}），請稍後再試")
    if not 200 <= status < 300 and status < 400:
        raise InvalidKey(f"{provider_id} 沒有確認這把金鑰（HTTP {status}）")
    if status >= 400:
        # 例如 Gemini 對無效金鑰回 400「API key not valid」：附上廠商自己的說明，使用者才知道是什麼問題。
        explanation = _error_message(response)
        raise InvalidKey(f"{provider_id} 拒絕了這把金鑰（HTTP {status}）" + (f"：{explanation}" if explanation else ""))


def _error_message(response: httpx2.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    error = body.get("error") if isinstance(body, dict) else None
    message = error.get("message") if isinstance(error, dict) else error
    return str(message)[:200] if message else ""
