"""已連結的帳號（見 CONTEXT.md）：gRPC 服務（真的 Postgres），Google 與 Notion 的 OAuth 端點在 HTTP 層換成假的
（httpx `MockTransport`），錄下收到的請求。"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import grpc
import httpx2
import pytest
from sqlalchemy import text

from app.core.config import settings
from app.db import new_session
from app.proto_gen import ai_pb2
from app.services import connections

USER = uuid.UUID("00000000-0000-0000-0000-0000000000e1")
REDIRECT = "http://localhost:5173/api/oauth/{service}/callback"
BROWSER = "cookie-value-in-the-users-browser"

GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke"
NOTION_REGISTER = "https://mcp.notion.com/register"
NOTION_TOKEN = "https://mcp.notion.com/token"


def form(request: httpx2.Request) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(request.content.decode()).items()}


def token_reply(access="access-1", refresh="refresh-1", expires_in=3600):
    return 200, {"access_token": access, "refresh_token": refresh, "expires_in": expires_in, "token_type": "Bearer"}


class FakeOAuth:
    """Google's and Notion's OAuth endpoints: records every request, answers token requests from a queue."""

    def __init__(self):
        self.requests: list[httpx2.Request] = []
        self.token_replies: list[tuple[int, dict] | Exception] = []
        self.revoke_status = 200
        self.registrations = 0

    def to(self, url: str) -> list[httpx2.Request]:
        return [r for r in self.requests if str(r.url).split("?")[0] == url]

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        url = str(request.url).split("?")[0]
        if url == NOTION_REGISTER:
            self.registrations += 1
            return httpx2.Response(201, json={"client_id": f"notion-client-{self.registrations}",
                                              **json.loads(request.content)})
        if url in (GOOGLE_TOKEN, NOTION_TOKEN) and "grant_type" in form(request):
            reply = self.token_replies.pop(0) if self.token_replies else token_reply()
            if isinstance(reply, Exception):
                raise reply
            return httpx2.Response(reply[0], json=reply[1])
        if url in (GOOGLE_REVOKE, NOTION_TOKEN):
            return httpx2.Response(self.revoke_status, json=self.revoke_reply)
        return httpx2.Response(404)

    revoke_reply: dict | None = None


@pytest.fixture
def oauth(monkeypatch):
    fake = FakeOAuth()
    monkeypatch.setattr(connections, "_http_client", httpx2.Client(transport=httpx2.MockTransport(fake.handle)))
    monkeypatch.setattr(settings, "google_oauth_client_id", "google-client-id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "google-client-secret")
    return fake


def start(stub, service, user_id=USER, browser=BROWSER):
    response = stub.StartConnection(ai_pb2.StartConnectionRequest(
        user_id=str(user_id), service=service, redirect_uri=REDIRECT.format(service=service), browser_binding=browser))
    return urlparse(response.authorize_url), {k: v[0] for k, v in parse_qs(urlparse(response.authorize_url).query).items()}


def complete(stub, service, state, code="the-code", error="", browser=BROWSER):
    return stub.CompleteConnection(ai_pb2.CompleteConnectionRequest(
        service=service, state=state, code=code, error=error, browser_binding=browser))


def connect(stub, service, user_id=USER, code="the-code"):
    _, query = start(stub, service, user_id)
    complete(stub, service, query["state"], code)
    return query


def statuses(stub, user_id=USER):
    return {c.service: c.status for c in stub.ListConnections(ai_pb2.ListConnectionsRequest(user_id=str(user_id))).connections}


def expire_access_token(service, user_id=USER):
    session = new_session()
    try:
        session.execute(text("UPDATE oauth_connections SET expires_at = :t WHERE user_id = :u AND service = :s"),
                        {"t": datetime.now(timezone.utc) - timedelta(minutes=1), "u": user_id, "s": service})
        session.commit()
    finally:
        session.close()


# --- 開始連結 ---


def test_linking_google_sends_the_user_to_google_asking_only_for_calendar_gmail_drafts_and_tasks(ai_stub, db_session, oauth):
    url, query = start(ai_stub, "google")

    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://accounts.google.com/o/oauth2/v2/auth"
    assert query["client_id"] == "google-client-id"
    assert query["redirect_uri"] == "http://localhost:5173/api/oauth/google/callback"
    assert query["response_type"] == "code"
    assert set(query["scope"].split()) == {
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/tasks",
    }
    assert query["access_type"] == "offline"  # a refresh token, to keep access
    assert len(query["state"]) >= 32


def test_linking_notion_registers_a_client_once_and_uses_pkce(ai_stub, db_session, oauth):
    url, query = start(ai_stub, "notion")
    _, again = start(ai_stub, "notion")

    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://mcp.notion.com/authorize"
    assert oauth.registrations == 1
    [registration] = oauth.to(NOTION_REGISTER)
    body = json.loads(registration.content)
    assert body["redirect_uris"] == ["http://localhost:5173/api/oauth/notion/callback"]
    assert body["token_endpoint_auth_method"] == "none"
    assert query["client_id"] == again["client_id"] == "notion-client-1"
    assert query["code_challenge_method"] == "S256"
    assert query["code_challenge"] != again["code_challenge"]
    assert query["state"] != again["state"]


def test_an_unknown_service_cannot_be_linked(ai_stub, db_session, oauth):
    with pytest.raises(grpc.RpcError) as error:
        start(ai_stub, "dropbox")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_google_cannot_be_linked_until_the_platform_has_its_oauth_client(ai_stub, db_session, oauth, monkeypatch):
    monkeypatch.setattr(settings, "google_oauth_client_id", "")

    with pytest.raises(grpc.RpcError) as error:
        start(ai_stub, "google")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION


def test_nothing_can_be_linked_until_the_server_can_encrypt_tokens(ai_stub, db_session, oauth, monkeypatch):
    monkeypatch.setattr(settings, "key_encryption_key", "")

    with pytest.raises(grpc.RpcError) as error:
        start(ai_stub, "notion")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION
    assert oauth.requests == []


# --- 完成連結 ---


def test_completing_google_exchanges_the_code_and_the_account_shows_as_linked(ai_stub, db_session, oauth):
    assert statuses(ai_stub) == {"google": ai_pb2.CONNECTION_STATUS_NOT_CONNECTED, "notion": ai_pb2.CONNECTION_STATUS_NOT_CONNECTED}

    _, query = start(ai_stub, "google")
    response = complete(ai_stub, "google", query["state"], "the-code")

    assert response.user_id == str(USER)
    [exchange] = oauth.to(GOOGLE_TOKEN)
    assert form(exchange) == {
        "grant_type": "authorization_code", "code": "the-code", "client_id": "google-client-id",
        "client_secret": "google-client-secret", "redirect_uri": "http://localhost:5173/api/oauth/google/callback"}
    [google] = [c for c in ai_stub.ListConnections(ai_pb2.ListConnectionsRequest(user_id=str(USER))).connections
                if c.service == "google"]
    assert google.status == ai_pb2.CONNECTION_STATUS_CONNECTED
    assert google.HasField("connected_at")


def test_completing_notion_proves_the_pkce_verifier(ai_stub, db_session, oauth):
    import base64
    import hashlib

    _, query = start(ai_stub, "notion")
    complete(ai_stub, "notion", query["state"], "c")

    [exchange] = [r for r in oauth.to(NOTION_TOKEN) if "grant_type" in form(r)]
    sent = form(exchange)
    assert (sent["grant_type"], sent["client_id"]) == ("authorization_code", "notion-client-1")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(sent["code_verifier"].encode()).digest()).rstrip(b"=").decode()
    assert challenge == query["code_challenge"]
    assert statuses(ai_stub)["notion"] == ai_pb2.CONNECTION_STATUS_CONNECTED


def test_tokens_are_stored_encrypted(ai_stub, db_session, oauth):
    oauth.token_replies.append(token_reply(access="plain-access-token", refresh="plain-refresh-token"))
    connect(ai_stub, "google")

    row = db_session.execute(text("SELECT * FROM oauth_connections")).mappings().one()
    stored = b"".join(value for value in row.values() if isinstance(value, (bytes, memoryview)))
    assert b"plain-access-token" not in bytes(stored)
    assert b"plain-refresh-token" not in bytes(stored)


@pytest.mark.parametrize("state", ["made-up", ""])
def test_an_unknown_state_is_refused(ai_stub, db_session, oauth, state):
    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "google", state, "c")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert oauth.to(GOOGLE_TOKEN) == []


def test_a_state_works_only_once(ai_stub, db_session, oauth):
    query = connect(ai_stub, "google")

    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "google", query["state"], "c")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_state_for_another_service_is_refused(ai_stub, db_session, oauth):
    _, query = start(ai_stub, "google")

    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "notion", query["state"], "c")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_state_older_than_10_minutes_is_refused(ai_stub, db_session, oauth):
    _, query = start(ai_stub, "google")
    db_session.execute(text("UPDATE oauth_pending_authorizations SET created_at = :t"),
                       {"t": datetime.now(timezone.utc) - timedelta(minutes=11)})
    db_session.commit()

    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "google", query["state"], "c")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_declining_on_googles_side_links_nothing(ai_stub, db_session, oauth):
    _, query = start(ai_stub, "google")

    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "google", query["state"], code="", error="access_denied")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION
    assert oauth.to(GOOGLE_TOKEN) == []
    assert statuses(ai_stub)["google"] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED


def test_a_code_the_provider_rejects_links_nothing(ai_stub, db_session, oauth):
    oauth.token_replies.append((400, {"error": "invalid_grant"}))

    with pytest.raises(grpc.RpcError) as error:
        connect(ai_stub, "google")

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION
    assert statuses(ai_stub)["google"] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED


# --- 續期 ---


def test_an_expired_access_token_is_renewed_with_the_refresh_token(ai_stub, db_session, oauth):
    connect(ai_stub, "notion")
    expire_access_token("notion")
    oauth.token_replies.append(token_reply(access="access-2", refresh="refresh-2"))

    assert statuses(ai_stub)["notion"] == ai_pb2.CONNECTION_STATUS_CONNECTED

    refresh = [form(r) for r in oauth.to(NOTION_TOKEN) if form(r).get("grant_type") == "refresh_token"]
    assert refresh == [{"grant_type": "refresh_token", "refresh_token": "refresh-1", "client_id": "notion-client-1"}]
    assert connections.access_token(USER, "notion") == "access-2"
    expire_access_token("notion")
    connections.access_token(USER, "notion")  # the rotated refresh token is the one used next
    assert form(oauth.to(NOTION_TOKEN)[-1])["refresh_token"] == "refresh-2"


def test_a_token_that_is_still_valid_is_not_renewed(ai_stub, db_session, oauth):
    connect(ai_stub, "google")

    assert connections.access_token(USER, "google") == "access-1"
    assert len(oauth.to(GOOGLE_TOKEN)) == 1  # just the code exchange


def test_a_refresh_token_the_provider_rejects_marks_the_account_invalid(ai_stub, db_session, oauth):
    connect(ai_stub, "notion")
    expire_access_token("notion")
    oauth.token_replies.append((400, {"error": "invalid_grant"}))

    assert statuses(ai_stub)["notion"] == ai_pb2.CONNECTION_STATUS_INVALID
    with pytest.raises(connections.ConnectionInvalid):
        connections.access_token(USER, "notion")
    assert len([r for r in oauth.to(NOTION_TOKEN) if "grant_type" in form(r)]) == 2  # not asked again once invalid


def test_a_provider_that_cannot_be_reached_leaves_the_account_linked(ai_stub, db_session, oauth):
    connect(ai_stub, "google")
    expire_access_token("google")
    oauth.token_replies.append(httpx2.ConnectError("connection refused"))

    assert statuses(ai_stub)["google"] == ai_pb2.CONNECTION_STATUS_CONNECTED


def test_linking_again_replaces_an_invalid_account(ai_stub, db_session, oauth):
    connect(ai_stub, "notion")
    expire_access_token("notion")
    oauth.token_replies.append((400, {"error": "invalid_grant"}))
    statuses(ai_stub)

    connect(ai_stub, "notion")

    assert statuses(ai_stub)["notion"] == ai_pb2.CONNECTION_STATUS_CONNECTED


def test_accounts_are_per_user(ai_stub, db_session, oauth):
    connect(ai_stub, "google")

    assert statuses(ai_stub, user_id=uuid.uuid4())["google"] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED


# --- 中斷連結 ---


@pytest.mark.parametrize("service, revoke_url", [("google", GOOGLE_REVOKE), ("notion", NOTION_TOKEN)])
def test_unlinking_revokes_the_grant_and_forgets_the_tokens(ai_stub, db_session, oauth, service, revoke_url):
    connect(ai_stub, service)

    response = ai_stub.DeleteConnection(ai_pb2.DeleteConnectionRequest(user_id=str(USER), service=service))

    assert response.revoked is True
    [revoke] = [r for r in oauth.to(revoke_url) if "grant_type" not in form(r)]
    assert form(revoke)["token"] == "refresh-1"
    assert statuses(ai_stub)[service] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED
    assert db_session.execute(text("SELECT count(*) FROM oauth_connections")).scalar() == 0


def test_unlinking_forgets_the_tokens_even_when_revoking_fails(ai_stub, db_session, oauth):
    connect(ai_stub, "google")
    oauth.revoke_status = 503

    response = ai_stub.DeleteConnection(ai_pb2.DeleteConnectionRequest(user_id=str(USER), service="google"))

    assert response.revoked is False
    assert statuses(ai_stub)["google"] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED


def test_unlinking_an_account_that_is_not_linked_is_fine(ai_stub, db_session, oauth):
    response = ai_stub.DeleteConnection(ai_pb2.DeleteConnectionRequest(user_id=str(USER), service="notion"))

    assert response.revoked is True
    assert oauth.requests == []


# --- state 綁定開始連結的瀏覽器 ---


def test_the_link_only_completes_in_the_browser_that_started_it(ai_stub, db_session, oauth):
    """Someone else's authorize URL, approved in the user's browser, must not link the user's account to them."""
    _, query = start(ai_stub, "google", browser="attackers-browser")

    with pytest.raises(grpc.RpcError) as error:
        complete(ai_stub, "google", query["state"], browser="victims-browser")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert oauth.to(GOOGLE_TOKEN) == []
    assert statuses(ai_stub)["google"] == ai_pb2.CONNECTION_STATUS_NOT_CONNECTED


def test_linking_needs_a_browser_binding(ai_stub, db_session, oauth):
    with pytest.raises(grpc.RpcError) as error:
        start(ai_stub, "google", browser="")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_only_a_hash_of_the_browser_binding_is_stored(ai_stub, db_session, oauth):
    start(ai_stub, "google")

    stored = db_session.execute(text("SELECT * FROM oauth_pending_authorizations")).mappings().one()
    assert BROWSER not in [str(value) for value in stored.values()]


def test_abandoned_authorizations_are_cleared_out(ai_stub, db_session, oauth):
    start(ai_stub, "google")
    db_session.execute(text("UPDATE oauth_pending_authorizations SET created_at = :t"),
                       {"t": datetime.now(timezone.utc) - timedelta(minutes=11)})
    db_session.commit()

    start(ai_stub, "notion")

    assert db_session.execute(text("SELECT service FROM oauth_pending_authorizations")).scalars().all() == ["notion"]


def test_unlinking_an_account_whose_grant_is_already_gone_counts_as_revoked(ai_stub, db_session, oauth):
    connect(ai_stub, "google")
    oauth.revoke_status, oauth.revoke_reply = 400, {"error": "invalid_token"}

    response = ai_stub.DeleteConnection(ai_pb2.DeleteConnectionRequest(user_id=str(USER), service="google"))

    assert response.revoked is True


# --- 刪除帳號（.scratch/account-deletion/issues/02）---


def test_deleting_the_account_revokes_every_linked_account_and_forgets_the_tokens(ai_stub, db_session, oauth):
    from app.services import account_deletion
    connect(ai_stub, "google")
    connect(ai_stub, "notion")
    connect(ai_stub, "google", user_id=uuid.UUID(int=99))

    account_deletion.delete_account_data(USER)

    assert len(oauth.to(GOOGLE_REVOKE)) == 1  # 只有這位使用者的；另一位的 Google 沒被撤銷
    assert len([r for r in oauth.to(NOTION_TOKEN) if "grant_type" not in form(r)]) == 1
    assert statuses(ai_stub) == {"google": ai_pb2.CONNECTION_STATUS_NOT_CONNECTED,
                                 "notion": ai_pb2.CONNECTION_STATUS_NOT_CONNECTED}
    assert statuses(ai_stub, uuid.UUID(int=99))["google"] == ai_pb2.CONNECTION_STATUS_CONNECTED


def test_deleting_the_account_forgets_the_tokens_even_when_revoking_fails(ai_stub, db_session, oauth):
    from app.services import account_deletion
    connect(ai_stub, "google")
    oauth.revoke_status = 503

    account_deletion.delete_account_data(USER)

    assert db_session.execute(text("SELECT count(*) FROM oauth_connections")).scalar() == 0
