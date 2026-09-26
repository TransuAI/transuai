import json
import os

import httpx2
import pytest
from sqlalchemy import create_engine, text

# Tests that touch the database use their own database on the dev Postgres from infra's docker
# compose — never the real ai_db. Environment variables win over .env in pydantic-settings, and
# app.core.config reads them at import time, so this has to be set before anything under app/ is
# imported.
TEST_DB_NAME = "ai_test_db"
os.environ["DB_NAME"] = TEST_DB_NAME
# A fixed master key for encrypting own API keys (自有金鑰) in tests: 32 bytes, base64.
os.environ["KEY_ENCRYPTION_KEY"] = "dGVzdC1tYXN0ZXIta2V5LWZvci1hZXMtZ2NtLTMyYiE="

from app.core.config import settings  # noqa: E402
from app.db import engine, init_db, new_session  # noqa: E402


def _reset_schema():
    # Guard: this drops everything, so make sure it can only ever hit the test database.
    assert settings.db_name == TEST_DB_NAME, f"refusing to reset {settings.db_name!r}"
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def test_database():
    """A clean test database, (re)created per test session, with the schema set up the same way
    the service does it at startup (init_db)."""
    admin = create_engine(settings.database_url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}):
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    admin.dispose()

    _reset_schema()
    init_db()
    yield engine
    engine.dispose()


@pytest.fixture
def empty_schema(test_database):
    """An empty public schema for tests about how startup handles existing databases; the
    migrated schema is restored afterwards for the other tests."""
    _reset_schema()
    yield test_database
    _reset_schema()
    init_db()


@pytest.fixture
def db_session(test_database):
    """A session on the test database; tables are emptied after each test."""
    session = new_session()
    yield session
    session.close()
    with test_database.begin() as conn:
        conn.execute(text("TRUNCATE summaries, chapters, embeddings, qa_history, llm_usage, provider_keys"))


@pytest.fixture(scope="session")
def ai_stub(test_database):
    """The real AiService, served in-process on a free port."""
    from concurrent import futures

    import grpc

    from app.controllers.ai_controller import AiController
    from app.proto_gen import ai_pb2_grpc

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    ai_pb2_grpc.add_AiServiceServicer_to_server(AiController(), server)
    port = server.add_insecure_port("localhost:0")
    server.start()
    channel = grpc.insecure_channel(f"localhost:{port}")
    yield ai_pb2_grpc.AiServiceStub(channel)
    channel.close()
    server.stop(grace=None)


class FakeLlmProvider:
    """An OpenAI-compatible AI provider at the HTTP layer: records every request and answers each one
    with the next queued reply (a plain "ok" when nothing is queued). Everything above HTTP — the real
    client, streaming, usage parsing, error handling — runs for real."""

    def __init__(self):
        self.requests: list[httpx2.Request] = []
        self._replies: list[httpx2.Response] = []

    def reply(self, text: str, *, usage: tuple[int, int] | None = (12, 5)) -> None:
        body = {
            "id": "chatcmpl-test", "object": "chat.completion", "created": 0, "model": "test",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        }
        if usage is not None:
            body["usage"] = {"prompt_tokens": usage[0], "completion_tokens": usage[1], "total_tokens": sum(usage)}
        self._replies.append(httpx2.Response(200, json=body))

    def stream(self, deltas: list[str], *, usage: tuple[int, int] | None = (12, 5)) -> None:
        def chunk(delta: dict, choices: bool = True, extra: dict | None = None) -> str:
            body = {"id": "chatcmpl-test", "object": "chat.completion.chunk", "created": 0, "model": "test",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": None}] if choices else []}
            return "data: " + json.dumps({**body, **(extra or {})}, ensure_ascii=False) + "\n\n"

        events = [chunk({"role": "assistant", "content": ""})] + [chunk({"content": d}) for d in deltas]
        if usage is not None:
            events.append(chunk({}, choices=False, extra={"usage": {
                "prompt_tokens": usage[0], "completion_tokens": usage[1], "total_tokens": sum(usage)}}))
        events.append("data: [DONE]\n\n")
        self._replies.append(httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content="".join(events).encode()))

    def stream_then_fail(self, deltas: list[str], message: str) -> None:
        """A stream that sends some text, then an error event instead of finishing."""
        events = [
            "data: " + json.dumps({"id": "chatcmpl-test", "object": "chat.completion.chunk", "created": 0, "model": "test",
                                   "choices": [{"index": 0, "delta": {"content": d}, "finish_reason": None}]},
                                  ensure_ascii=False) + "\n\n"
            for d in deltas
        ] + ["data: " + json.dumps({"error": {"message": message}}) + "\n\n"]
        self._replies.append(httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content="".join(events).encode()))

    def fail(self, status: int, error: dict | None = None) -> None:
        self._replies.append(httpx2.Response(status, json={"error": error or {"message": f"status {status}"}}))

    def bodies(self) -> list[dict]:
        return [json.loads(request.content) for request in self.requests]

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        request.read()
        self.requests.append(request)
        if not self._replies:
            self.reply("ok")
        return self._replies.pop(0)


@pytest.fixture
def fake_llm(monkeypatch):
    """Points every generation call (summaries, chapters, Q&A) at a FakeLlmProvider."""
    from app.services import llm_client

    provider = FakeLlmProvider()
    monkeypatch.setattr(llm_client, "_http_client", httpx2.Client(transport=httpx2.MockTransport(provider.handle)))
    monkeypatch.setattr(llm_client.settings, "hf_api_key", "hf-test-key")
    return provider
