"""已連結的帳號（見 CONTEXT.md）：用 OAuth 取得代使用者存取 Google、Notion 的權杖，加密保存（跟自有金鑰同一套
AES-GCM，見 key_encryption.py），需要時用 refresh token 換新。每個服務是一份設定（ExternalService）；Google 用平台
自己的 OAuth client，Notion 是官方遠端 MCP 的授權流程（PKCE + 動態註冊 client）。權杖只在 ai-service 裡用，不回傳。"""

import base64
import hashlib
import hmac
import logging
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx2
from cryptography.exceptions import InvalidTag

from app.core.config import settings
from app.db import new_session
from app.models import ConnectionStatus, OAuthClient, OAuthConnection, OAuthPendingAuthorization
from app.repositories.connection_repository import (
    delete_connection,
    find_client,
    find_connection,
    replace_connection,
    save_client,
    save_pending,
    take_pending,
)
from app.services.key_encryption import EncryptionUnavailable, decrypt, encrypt, ensure_available, key_binding

logger = logging.getLogger(__name__)

_http_client = httpx2.Client(timeout=httpx2.Timeout(10.0, connect=5.0))

PENDING_FOR = timedelta(minutes=10)
# Renew a little before the provider's deadline, so a token handed out isn't about to expire.
_RENEW_BEFORE = timedelta(minutes=1)


def _google_client() -> tuple[str, str]:
    return settings.google_oauth_client_id, settings.google_oauth_client_secret


@dataclass(frozen=True)
class ExternalService:
    id: str
    name: str
    authorize_url: str
    token_url: str
    revoke_url: str
    scopes: tuple[str, ...] = ()
    uses_pkce: bool = False
    # 平台自己的 OAuth client（id, secret），從設定讀；沒有的服務是公開 client，第一次連結時向 registration_url 動態註冊。
    platform_client: Callable[[], tuple[str, str]] | None = None
    registration_url: str | None = None
    authorize_params: dict[str, str] = field(default_factory=dict)


SERVICES: dict[str, ExternalService] = {
    "google": ExternalService(
        id="google",
        name="Google",
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        revoke_url="https://oauth2.googleapis.com/revoke",
        # Calendar（查行程、建立活動）、Gmail 只建立草稿、Tasks；不要讀信的權限。
        scopes=(
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/gmail.compose",
            "https://www.googleapis.com/auth/tasks",
        ),
        # offline：拿 refresh token；consent：每次都重新給，重新連結時才一定拿得到。
        authorize_params={"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"},
        platform_client=_google_client,
    ),
    "notion": ExternalService(
        id="notion",
        name="Notion",
        # 端點取自 https://mcp.notion.com/.well-known/oauth-authorization-server（撤銷也是 /token）。
        authorize_url="https://mcp.notion.com/authorize",
        token_url="https://mcp.notion.com/token",
        revoke_url="https://mcp.notion.com/token",
        uses_pkce=True,
        registration_url="https://mcp.notion.com/register",
    ),
}


class UnknownService(Exception):
    pass


class ServiceNotConfigured(Exception):
    """The platform can't link this service yet (no Google OAuth client, or no encryption key)."""


class ServiceUnreachable(Exception):
    """The provider couldn't be reached or answered with a server error; nothing changed."""


class InvalidBrowserBinding(Exception):
    """Linking was started without the browser's cookie value."""


class UnknownAuthorization(Exception):
    """The state doesn't belong to a pending authorization of this service started in this browser (made up, used,
    expired, or opened in another browser)."""


class AuthorizationFailed(Exception):
    """The user declined, or the provider wouldn't exchange the code."""


class NotConnected(Exception):
    pass


class ConnectionInvalid(Exception):
    """The access can't be renewed: the user has to link the account again."""


@dataclass(frozen=True)
class ConnectionState:
    service: str
    status: ConnectionStatus | None  # None: not linked
    connected_at: datetime | None


def _service(service_id: str) -> ExternalService:
    service = SERVICES.get(service_id)
    if service is None:
        raise UnknownService(service_id)
    return service


def _binding(user_id: uuid.UUID, service: str, kind: str) -> str:
    return key_binding(user_id, f"connection:{service}:{kind}")


def _hash_binding(browser_binding: str) -> str:
    return hashlib.sha256(browser_binding.encode()).hexdigest()


def _client_secret(service: ExternalService) -> dict[str, str]:
    """平台自己的 client 換權杖時要附 secret；公開 client 沒有。"""
    return {"client_secret": service.platform_client()[1]} if service.platform_client else {}


def _client_id(service: ExternalService, redirect_uri: str) -> str:
    if service.platform_client is not None:
        client_id = service.platform_client()[0]
        if not client_id:
            raise ServiceNotConfigured(f"伺服器沒有設定 {service.name} 的 OAuth client，暫時無法連結 {service.name}")
        return client_id
    assert service.registration_url is not None
    session = new_session()
    try:
        client = find_client(session, service.id, redirect_uri)
        if client is not None:
            return client.client_id
        client_id = _register_client(service, redirect_uri)
        save_client(session, OAuthClient(service=service.id, redirect_uri=redirect_uri, client_id=client_id,
                                         created_at=datetime.now(timezone.utc)))
        return client_id
    finally:
        session.close()


def _register_client(service: ExternalService, redirect_uri: str) -> str:
    """動態註冊 client（RFC 7591）：公開 client，不用 secret，靠 PKCE。"""
    assert service.registration_url is not None
    try:
        response = _http_client.post(service.registration_url, json={
            "client_name": "TransuAI",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })
    except httpx2.HTTPError as exc:
        raise ServiceUnreachable(f"暫時連不上 {service.name}，請稍後再試") from exc
    if not response.is_success:
        raise ServiceUnreachable(f"{service.name} 拒絕註冊（HTTP {response.status_code}），請稍後再試")
    return response.json()["client_id"]


def _code_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def start_connection(user_id: uuid.UUID, service_id: str, redirect_uri: str, browser_binding: str) -> str:
    """記下這次授權（綁定開始連結的瀏覽器：只存 browser_binding 的雜湊），回傳要把使用者轉過去的授權網址。"""
    service = _service(service_id)
    if not browser_binding:
        raise InvalidBrowserBinding()
    try:
        ensure_available()
    except EncryptionUnavailable as exc:
        raise ServiceNotConfigured("伺服器沒有設定加密金鑰，暫時無法連結帳號") from exc
    client_id = _client_id(service, redirect_uri)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64) if service.uses_pkce else None
    now = datetime.now(timezone.utc)
    session = new_session()
    try:
        save_pending(session, OAuthPendingAuthorization(
            state=state, user_id=user_id, service=service.id, redirect_uri=redirect_uri, client_id=client_id,
            browser_binding_hash=_hash_binding(browser_binding), code_verifier=verifier, created_at=now),
            drop_created_before=now - PENDING_FOR)
    finally:
        session.close()
    params = {"client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "state": state,
              **({"scope": " ".join(service.scopes)} if service.scopes else {}),
              **({"code_challenge": _code_challenge(verifier), "code_challenge_method": "S256"} if verifier else {}),
              **service.authorize_params}
    return f"{service.authorize_url}?{urlencode(params)}"


def complete_connection(service_id: str, state: str, code: str, error: str, browser_binding: str) -> uuid.UUID:
    """對方回呼：用 state 找回使用者（只能用一次，而且要在開始連結的同一個瀏覽器），拿 code 換權杖並加密保存。回傳連結的
    使用者。"""
    service = _service(service_id)
    session = new_session()
    try:
        pending = take_pending(session, state, service.id, created_after=datetime.now(timezone.utc) - PENDING_FOR)
    finally:
        session.close()
    if pending is None or not hmac.compare_digest(pending.browser_binding_hash, _hash_binding(browser_binding)):
        raise UnknownAuthorization()
    if error:
        raise AuthorizationFailed(f"使用者沒有同意授權（{error}）")
    tokens = _token_request(service, {
        "grant_type": "authorization_code", "code": code, "client_id": pending.client_id,
        "redirect_uri": pending.redirect_uri, **_client_secret(service),
        **({"code_verifier": pending.code_verifier} if pending.code_verifier else {})})
    if tokens is None:
        raise AuthorizationFailed("無法完成授權，請再連結一次")
    now = datetime.now(timezone.utc)
    user_id = pending.user_id
    session = new_session()
    try:
        replace_connection(session, OAuthConnection(
            user_id=user_id, service=service.id, status=ConnectionStatus.CONNECTED,
            encrypted_access_token=encrypt(tokens["access_token"], bound_to=_binding(user_id, service.id, "access")),
            encrypted_refresh_token=(encrypt(tokens["refresh_token"], bound_to=_binding(user_id, service.id, "refresh"))
                                     if tokens.get("refresh_token") else None),
            expires_at=_expires_at(tokens, now), client_id=pending.client_id, connected_at=now))
    finally:
        session.close()
    logger.info("user %s linked %s", user_id, service.id)
    return user_id


def _token_request(service: ExternalService, form: dict[str, str]) -> dict | None:
    """向對方的 token 端點要權杖：成功回傳內容；對方拒絕（4xx）回傳 None；連不上或 5xx raise ServiceUnreachable。"""
    try:
        response = _http_client.post(service.token_url, data=form, headers={"Accept": "application/json"})
    except httpx2.HTTPError as exc:
        raise ServiceUnreachable(f"暫時連不上 {service.id}") from exc
    if response.status_code >= 500:
        raise ServiceUnreachable(f"{service.id} 暫時無法回應（HTTP {response.status_code}）")
    if not response.is_success:
        logger.warning("%s refused a token request (HTTP %s): %s", service.id, response.status_code, response.text[:200])
        return None
    return response.json()


def _expires_at(tokens: dict, now: datetime) -> datetime | None:
    expires_in = tokens.get("expires_in")
    return now + timedelta(seconds=int(expires_in)) if expires_in else None


def access_token(user_id: uuid.UUID, service_id: str) -> str:
    """現在可以用的存取權杖：快過期就先用 refresh token 換新（Notion 會連 refresh token 一起換）。對方拒絕就把連結標成
    已失效並 raise ConnectionInvalid；連不上 raise ServiceUnreachable，連結維持原狀。"""
    service = _service(service_id)
    session = new_session()
    try:
        connection = find_connection(session, user_id, service.id, lock=True)
        if connection is None:
            raise NotConnected()
        if connection.status == ConnectionStatus.INVALID:
            raise ConnectionInvalid()
        now = datetime.now(timezone.utc)
        try:
            if connection.expires_at is None or connection.expires_at - _RENEW_BEFORE > now:
                return decrypt(connection.encrypted_access_token, bound_to=_binding(user_id, service.id, "access"))
            refresh_token = (decrypt(connection.encrypted_refresh_token, bound_to=_binding(user_id, service.id, "refresh"))
                             if connection.encrypted_refresh_token else None)
        except InvalidTag:
            # The master key changed, or the row was tampered with: these tokens are gone for good.
            refresh_token = None
        tokens = (_token_request(service, {"grant_type": "refresh_token", "refresh_token": refresh_token,
                                           "client_id": connection.client_id, **_client_secret(service)})
                  if refresh_token else None)
        if tokens is None:
            connection.status = ConnectionStatus.INVALID
            session.commit()
            logger.info("user %s's %s link can no longer be renewed", user_id, service.id)
            raise ConnectionInvalid()
        connection.encrypted_access_token = encrypt(tokens["access_token"], bound_to=_binding(user_id, service.id, "access"))
        if tokens.get("refresh_token"):
            connection.encrypted_refresh_token = encrypt(
                tokens["refresh_token"], bound_to=_binding(user_id, service.id, "refresh"))
        connection.expires_at = _expires_at(tokens, now)
        session.commit()
        return tokens["access_token"]
    finally:
        session.close()


def list_connections(user_id: uuid.UUID) -> list[ConnectionState]:
    """每個服務的狀態。已連結的先確認存取權杖還能用（過期就換新），換不到就是已失效；連不上對方時照存下的狀態。"""
    states = []
    for service_id in SERVICES:
        session = new_session()
        try:
            connection = find_connection(session, user_id, service_id)
            connected_at, stored = (connection.connected_at, connection.status) if connection else (None, None)
        finally:
            session.close()
        if stored is None:
            states.append(ConnectionState(service_id, None, None))
            continue
        try:
            access_token(user_id, service_id)
            status = ConnectionStatus.CONNECTED
        except ConnectionInvalid:
            status = ConnectionStatus.INVALID
        except Exception:
            logger.warning("could not check user %s's %s link", user_id, service_id, exc_info=True)
            status = ConnectionStatus(stored)
        states.append(ConnectionState(service_id, status, connected_at))
    return states


def disconnect(user_id: uuid.UUID, service_id: str) -> bool:
    """向對方撤銷授權並刪除權杖；撤銷不成功（連不上、對方拒絕）時權杖照樣刪除，回傳 False。"""
    service = _service(service_id)
    session = new_session()
    try:
        connection = find_connection(session, user_id, service.id, lock=True)
        if connection is None:
            return True
        revoked = _revoke(service, user_id, connection)
        delete_connection(session, user_id, service.id)
        logger.info("user %s unlinked %s (revoked: %s)", user_id, service.id, revoked)
        return revoked
    finally:
        session.close()


def _revoke(service: ExternalService, user_id: uuid.UUID, connection: OAuthConnection) -> bool:
    # Revoking the refresh token ends the whole grant; the access token alone when there is none.
    try:
        token = (decrypt(connection.encrypted_refresh_token, bound_to=_binding(user_id, service.id, "refresh"))
                 if connection.encrypted_refresh_token
                 else decrypt(connection.encrypted_access_token, bound_to=_binding(user_id, service.id, "access")))
    except Exception:
        logger.warning("could not decrypt user %s's %s token to revoke it", user_id, service.id, exc_info=True)
        return False
    form = {"token": token}
    if service.platform_client is None:  # a public client identifies itself with its id
        form |= {"token_type_hint": "refresh_token" if connection.encrypted_refresh_token else "access_token",
                 "client_id": connection.client_id}
    try:
        response = _http_client.post(service.revoke_url, data=form)
    except httpx2.HTTPError:
        logger.warning("could not reach %s to revoke user %s's grant", service.id, user_id, exc_info=True)
        return False
    # A token the provider no longer knows means the grant is already gone (e.g. revoked on the provider's side).
    return response.is_success or (response.status_code == 400 and _error_code(response) == "invalid_token")


def _error_code(response: httpx2.Response) -> str | None:
    try:
        return response.json().get("error")
    except ValueError:
        return None
