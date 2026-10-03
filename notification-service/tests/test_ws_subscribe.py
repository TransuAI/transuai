"""WebSocket 訂閱要驗證身分與 Job 擁有者、限制同時連線數（見 .scratch/pre-launch-hardening/issues/10）。"""

import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.controllers import ws_controller
from app.core.config import settings
from app.main import create_app
from app.services.connection_limits import ConnectionLimits
from app.services.job_access import JobAccessUnavailable

ALICE = str(uuid.uuid4())
BOB = str(uuid.uuid4())
ALICES_JOB = str(uuid.uuid4())


def token(user_id: str = ALICE, *, secret: str = settings.jwt_secret, type_: str = "access", expires_in: int = 900) -> str:
    now = int(time.time())
    claims = {"sub": user_id, "type": type_, "iat": now, "exp": now + expires_in}
    return jwt.encode(claims, secret, algorithm="HS384")


class FakeJobAccess:
    """Alice 擁有 ALICES_JOB；unavailable 時像是問不到 upload-service。"""

    def __init__(self) -> None:
        self.unavailable = False
        self.asked: list[tuple[str, str]] = []

    async def owns(self, user_id: str, job_id: str) -> bool:
        self.asked.append((user_id, job_id))
        if self.unavailable:
            raise JobAccessUnavailable()
        return user_id == ALICE and job_id == ALICES_JOB


@pytest.fixture
def access() -> FakeJobAccess:
    return FakeJobAccess()


@pytest.fixture
def limits() -> ConnectionLimits:
    return ConnectionLimits(per_user=2, per_address=3)


@pytest.fixture
def client(access, limits) -> TestClient:
    app = create_app(production=False)
    app.dependency_overrides[ws_controller.get_job_access] = lambda: access
    app.dependency_overrides[ws_controller.get_connection_limits] = lambda: limits
    return TestClient(app)


def subscribe(ws, access_token: str) -> None:
    ws.send_json({"type": "auth", "accessToken": access_token})


def closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    return closed.value.code


def test_the_owner_with_a_valid_token_is_subscribed(client):
    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        subscribe(ws, token())

        assert ws.receive_json() == {"type": "subscribed", "jobId": ALICES_JOB}


@pytest.mark.parametrize("bad_token", [
    token(secret="some-other-secret-that-is-long-enough-to-sign-with"),
    token(expires_in=-60),
    token(type_="refresh"),
    token(user_id="not-a-uuid"),
    "not-a-jwt",
])
def test_an_unusable_token_is_refused(client, access, bad_token):
    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        subscribe(ws, bad_token)

        assert closed_with(ws) == ws_controller.CLOSE_UNAUTHORIZED
    assert access.asked == []


@pytest.mark.parametrize("first_message", ['{"type":"hello"}', "not json", '{"type":"auth"}', "[]"])
def test_the_first_message_must_carry_the_token(client, first_message):
    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        ws.send_text(first_message)

        assert closed_with(ws) == ws_controller.CLOSE_UNAUTHORIZED


def test_a_client_that_never_sends_the_token_is_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "ws_auth_timeout_seconds", 0.05)

    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        assert closed_with(ws) == ws_controller.CLOSE_UNAUTHORIZED


@pytest.mark.parametrize("user_id, job_id", [(BOB, ALICES_JOB), (ALICE, str(uuid.uuid4()))])
def test_someone_elses_or_a_missing_job_is_refused(client, user_id, job_id):
    with client.websocket_connect(f"/ws/jobs/{job_id}") as ws:
        subscribe(ws, token(user_id))

        assert closed_with(ws) == ws_controller.CLOSE_JOB_NOT_FOUND


def test_when_upload_service_cannot_be_reached_the_client_is_told_to_try_again(client, access):
    access.unavailable = True

    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        subscribe(ws, token())

        assert closed_with(ws) == ws_controller.CLOSE_TRY_AGAIN_LATER


def test_a_user_cannot_hold_more_than_the_limit(client, access):
    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as first, \
            client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as second:
        for ws in (first, second):
            subscribe(ws, token())
            ws.receive_json()

        with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as third:
            subscribe(third, token())

            assert closed_with(third) == ws_controller.CLOSE_TOO_MANY_CONNECTIONS
    # 超過上限的那條不用再去問 upload-service。
    assert len(access.asked) == 2


def test_an_address_cannot_hold_more_than_the_limit_even_before_authenticating(client):
    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}"), \
            client.websocket_connect(f"/ws/jobs/{ALICES_JOB}"), \
            client.websocket_connect(f"/ws/jobs/{ALICES_JOB}"):
        with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as fourth:
            assert closed_with(fourth) == ws_controller.CLOSE_TOO_MANY_CONNECTIONS


def test_closed_connections_free_their_place(client, limits):
    for _ in range(5):
        with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
            subscribe(ws, token())
            assert ws.receive_json()["type"] == "subscribed"

    with client.websocket_connect(f"/ws/jobs/{ALICES_JOB}") as ws:
        subscribe(ws, token(BOB))
        closed_with(ws)

    assert limits.take_user(ALICE) and limits.take_user(ALICE)
    assert limits.take_address("testclient")


def test_the_limits_count_per_user_and_per_address():
    limits = ConnectionLimits(per_user=1, per_address=1)

    assert limits.take_user(ALICE)
    assert not limits.take_user(ALICE)
    assert limits.take_user(BOB)
    limits.release_user(ALICE)
    assert limits.take_user(ALICE)

    assert limits.take_address("10.0.0.1")
    assert not limits.take_address("10.0.0.1")
    assert limits.take_address("10.0.0.2")
