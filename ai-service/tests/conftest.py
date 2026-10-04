import atexit
import json
import os

import httpx2
import pytest
from sqlalchemy import text
from testcontainers.community.postgres import PostgresContainer

# Tests that touch the database get a throwaway Postgres (with pgvector) that testcontainers starts
# for this test run and removes afterwards — never the real ai_db, and nothing to start by hand
# (Docker has to be running). Environment variables win over .env in pydantic-settings, and
# app.core.config reads them at import time, so this has to happen before anything under app/ is
# imported.
TEST_DB_NAME = "ai_test_db"
_postgres = PostgresContainer("pgvector/pgvector:pg16", username="test", password="test", dbname=TEST_DB_NAME)
_postgres.start()
atexit.register(_postgres.stop)
os.environ |= {
    "DB_HOST": _postgres.get_container_host_ip(),
    "DB_PORT": str(_postgres.get_exposed_port(5432)),
    "DB_USER": "test",
    "DB_PASSWORD": "test",
    "DB_NAME": TEST_DB_NAME,
}
# A fixed master key for encrypting own API keys (自有金鑰) in tests: 32 bytes, base64.
os.environ["KEY_ENCRYPTION_KEY"] = "dGVzdC1tYXN0ZXIta2V5LWZvci1hZXMtZ2NtLTMyYiE="

from app.core.config import settings  # noqa: E402
from app.db import engine, init_db, new_session  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.services import job_deletion  # noqa: E402

# 跟正式環境一樣：刪掉的 Job 晚到的寫入會被丟掉（main.serve 也這樣掛）。
job_deletion.guard_writes(SessionLocal)


def _reset_schema():
    # Guard: this drops everything, so make sure it can only ever hit the test database.
    assert settings.db_name == TEST_DB_NAME, f"refusing to reset {settings.db_name!r}"
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def test_database():
    """A clean test database with the schema set up the same way the service does it at startup
    (init_db)."""
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
        conn.execute(text("TRUNCATE summaries, chapters, embeddings, qa_history, llm_usage, web_search_usage, speaker_name_suggestions, provider_keys, default_models, quizzes, quiz_questions, quiz_attempts, oauth_connections, oauth_pending_authorizations, oauth_clients, post_meeting_runs, action_proposals, post_meeting_settings, deleted_jobs, speaker_insights, speaker_insight_items, generated_outputs, translations, segment_translations, decisions, decision_extractions, fact_checks, claims"))


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

    def reply_tool_calls(self, calls: list[tuple[str, dict | str]], *, text: str = "",
                         extra: dict | None = None, usage: tuple[int, int] | None = (12, 5)) -> None:
        """A turn that calls tools: (name, arguments) each, arguments as a dict or a raw string. `extra` is added to
        every tool call as-is (e.g. Gemini's `extra_content` with its thought signature)."""
        tool_calls = [{"id": f"call_{len(self._replies)}_{i}", "type": "function",
                       "function": {"name": name, "arguments": args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)},
                       **(extra or {})}
                      for i, (name, args) in enumerate(calls)]
        body = {
            "id": "chatcmpl-test", "object": "chat.completion", "created": 0, "model": "test",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text or None, "tool_calls": tool_calls},
                         "finish_reason": "tool_calls"}],
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


@pytest.fixture
def providers(monkeypatch):
    """The AI providers' own APIs besides chat (see app/services/providers.py): the key-check APIs answer
    `providers.status` (200 unless a test changes it) with `providers.body`; OpenRouter's public model list answers
    `providers.openrouter_models`. Every request is recorded in `providers.requests`."""
    from types import SimpleNamespace

    from app.services import model_catalog, provider_keys

    state = SimpleNamespace(requests=[], status=200, body={"data": []}, unreachable=False, openrouter_models=[])

    def handle(request: httpx2.Request) -> httpx2.Response:
        state.requests.append(request)
        if state.unreachable:
            raise httpx2.ConnectError("connection refused", request=request)
        if str(request.url) == "https://openrouter.ai/api/v1/models":
            return httpx2.Response(200, json={"data": state.openrouter_models})
        return httpx2.Response(state.status, json=state.body)

    client = httpx2.Client(transport=httpx2.MockTransport(handle))
    monkeypatch.setattr(provider_keys, "_http_client", client)
    monkeypatch.setattr(model_catalog, "_http_client", client)
    return state
