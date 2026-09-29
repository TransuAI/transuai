"""問答查網路（見 CONTEXT.md「網路搜尋」）：`stream_answer()` 這個 seam，檢索與 transcript client mock 掉，模型是假的 AI 廠商
（HTTP 層），Tavily 是程式內的假 MCP server（跟 Notion 的測試一樣，MCP client 照正式的路徑走）。"""

import asyncio
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app.proto_gen import ai_pb2, transcription_pb2
from app.services import qa, web_search
from app.services.web_search import WebSource

TRANSCRIPT = transcription_pb2.Transcript(segments=[], speakers=[])
PASSAGE = SimpleNamespace(start_time=Decimal("754.00"), end_time=Decimal("760.00"),
                          chunk_text="我們下一季改用 pgvector 做檢索")


class FakeTavily:
    """Tavily's remote MCP server, in-process: its search tool, recording every call."""

    def __init__(self):
        self.queries: list[str] = []
        self.results: list[dict] = []
        self.error: Exception | None = None
        self.refusal: dict | None = None
        self.delay = 0.0
        server = MCPServer("fake-tavily")

        @server.tool(name="tavily_search")
        async def search(query: str, max_results: int = 5, search_depth: str = "basic") -> str:
            self.queries.append(query)
            await asyncio.sleep(self.delay)
            if self.error:
                raise self.error
            if self.refusal:
                return json.dumps(self.refusal)  # a normal answer whose body says no, like a used-up plan
            return json.dumps({"query": query, "results": self.results[:max_results]}, ensure_ascii=False)

        self.server = server

    def found(self, *pages: tuple[str, str, str]) -> None:
        self.results = [{"title": title, "url": url, "content": content, "score": 0.9} for title, url, content in pages]


@pytest.fixture
def tavily(monkeypatch):
    fake = FakeTavily()
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "tvly-test-key")
    monkeypatch.setattr(web_search, "server_override", fake.server)
    return fake


@pytest.fixture
def ask(fake_llm):
    """Asks one question; returns the streamed events and the system prompt the (fake) model answered from."""

    def _ask(*, web_search: bool, history=(), summary: str | None = None, search_query: str = "pgvector 是什麼",
             searches: bool | None = None):
        if web_search if searches is None else searches:
            fake_llm.reply(search_query)  # the search query the model writes from the question
        fake_llm.stream(["pgvector 是 Postgres 的向量檢索擴充 [1]。"])
        with (
            patch.object(qa, "find_by_job_id", return_value=list(history)),
            patch.object(qa, "find_summary", return_value=SimpleNamespace(summary_text=summary) if summary else None),
            patch.object(qa, "find_chapters", return_value=[]),
            patch.object(qa, "embed_query", return_value=[0.1]),
            patch.object(qa, "find_similar", return_value=[PASSAGE]),
            patch.object(qa, "transcript_client") as transcript_client,
        ):
            transcript_client.get_transcript.return_value = TRANSCRIPT
            events = list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "他們說的 pgvector 是什麼？",
                                           user_id=None, web_search=web_search))
        return events, fake_llm.bodies()[-1]["messages"][0]["content"]

    return _ask


def test_with_web_search_on_the_results_are_given_to_the_model_as_numbered_web_sources(ask, tavily):
    tavily.found(("pgvector: Open-source vector similarity search for Postgres", "https://github.com/pgvector/pgvector",
                  "Store your vectors with the rest of your data."))

    events, prompt = ask(web_search=True)

    assert [kind for kind, _ in events] == ["sources", "web_sources", "answered_by", "delta"]
    assert events[1][1] == web_search.WebSearchResult(
        sources=[WebSource(title="pgvector: Open-source vector similarity search for Postgres",
                           url="https://github.com/pgvector/pgvector")],
        failed=False)
    assert "## 網路搜尋結果" in prompt
    assert "[1] pgvector: Open-source vector similarity search for Postgres（github.com）" in prompt
    assert "Store your vectors with the rest of your data." in prompt
    assert "[12:34] 我們下一季改用 pgvector 做檢索" in prompt  # the recording is still there


def test_with_web_search_off_nothing_is_searched_and_the_answer_is_as_before(ask, tavily):
    tavily.found(("pgvector", "https://github.com/pgvector/pgvector", "Open-source vector similarity search"))

    events, prompt = ask(web_search=False)

    assert [kind for kind, _ in events] == ["sources", "answered_by", "delta"]
    assert tavily.queries == []
    assert "網路搜尋" not in prompt


@pytest.mark.parametrize("failure", ["error", "refusal"])
def test_when_the_search_fails_it_still_answers_from_the_content_and_says_the_search_failed(ask, tavily, failure):
    if failure == "error":
        tavily.error = RuntimeError("search backend down")
    else:
        tavily.refusal = {"code": "usage_limit_exceeded", "message": "This request exceeds your plan's set usage limit."}

    events, prompt = ask(web_search=True)

    assert [kind for kind, _ in events] == ["sources", "web_sources", "answered_by", "delta"]
    assert events[1][1] == web_search.WebSearchResult(sources=[], failed=True)
    assert "網路搜尋" not in prompt
    assert "[12:34] 我們下一季改用 pgvector 做檢索" in prompt


def test_a_search_that_takes_too_long_is_given_up_on(ask, tavily, monkeypatch):
    monkeypatch.setattr(web_search, "_TIMEOUT_SECONDS", 0.2)
    tavily.found(("pgvector", "https://github.com/pgvector/pgvector", "Open-source vector similarity search"))
    tavily.delay = 2.0

    events, prompt = ask(web_search=True)

    assert events[1][1] == web_search.WebSearchResult(sources=[], failed=True)
    assert "網路搜尋" not in prompt


def test_only_a_search_query_written_from_the_question_and_the_summary_is_sent(ask, tavily, fake_llm):
    tavily.found(("pgvector", "https://github.com/pgvector/pgvector", "Open-source vector similarity search"))

    ask(web_search=True, summary="團隊討論下一季把檢索從 Elasticsearch 換成 pgvector。", search_query="「pgvector 是什麼」")

    rewrite = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "他們說的 pgvector 是什麼？" in rewrite
    assert "團隊討論下一季把檢索從 Elasticsearch 換成 pgvector。" in rewrite  # to name what the question points at
    assert "我們下一季改用 pgvector 做檢索" not in rewrite  # the transcript itself stays out of the query
    assert tavily.queries == ["pgvector 是什麼"]  # just the query, tidied up


def test_a_follow_up_is_searched_with_what_the_earlier_turns_were_about(ask, tavily, fake_llm):
    history = [SimpleNamespace(question="他們要換成什麼資料庫？", answer="換成 pgvector。")]
    fake_llm.reply("他們要換成什麼資料庫？")  # the rewrite for retrieval comes first

    ask(web_search=True, history=history, search_query="pgvector 效能")

    search_rewrite = fake_llm.bodies()[1]["messages"][0]["content"]
    assert "他們要換成什麼資料庫？" in search_rewrite and "換成 pgvector。" in search_rewrite
    assert tavily.queries == ["pgvector 效能"]


def test_without_a_search_service_configured_asking_to_search_changes_nothing(ask, tavily, monkeypatch):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", "")

    events, _ = ask(web_search=True, searches=False)

    assert [kind for kind, _ in events] == ["sources", "answered_by", "delta"]
    assert tavily.queries == []


# --- 透過 gRPC：串流、保存在問答紀錄、能不能查網路（真的 Postgres） ---

USER = uuid.UUID("00000000-0000-0000-0000-0000000000e1")


@contextmanager
def retrieval():
    """The job has one retrieved passage; everything else (summary, history, saving) is the real database."""
    with (
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[PASSAGE]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = TRANSCRIPT
        yield


def ask_over_grpc(ai_stub, job_id: uuid.UUID, *, web_search: bool) -> list:
    with retrieval():
        return list(ai_stub.AskQuestion(ai_pb2.AskQuestionRequest(
            job_id=str(job_id), user_id=str(USER), question="他們說的 pgvector 是什麼？", web_search=web_search)))


def test_the_web_sources_are_streamed_and_kept_with_the_question(ai_stub, db_session, fake_llm, tavily):
    tavily.found(("pgvector", "https://github.com/pgvector/pgvector", "Open-source vector similarity search"),
                 ("Supabase: pgvector", "https://supabase.com/docs/guides/database/extensions/pgvector", "Embeddings"))
    fake_llm.reply("pgvector 是什麼")
    fake_llm.stream(["是 Postgres 的擴充 [1]。"])
    job_id = uuid.uuid4()

    chunks = ask_over_grpc(ai_stub, job_id, web_search=True)

    assert [chunk.WhichOneof("payload") for chunk in chunks] == ["sources", "web_sources", "answered_by", "delta"]
    expected = [("pgvector", "https://github.com/pgvector/pgvector"),
                ("Supabase: pgvector", "https://supabase.com/docs/guides/database/extensions/pgvector")]
    assert [(s.title, s.url) for s in chunks[1].web_sources.sources] == expected
    assert not chunks[1].web_sources.failed
    (turn,) = ai_stub.ListQaHistory(ai_pb2.ListQaHistoryRequest(job_id=str(job_id))).turns
    assert turn.web_search
    assert [(s.title, s.url) for s in turn.web_sources] == expected


def test_a_failed_search_is_kept_as_searched_with_no_web_sources(ai_stub, db_session, fake_llm, tavily):
    tavily.error = RuntimeError("down")
    fake_llm.reply("pgvector 是什麼")
    fake_llm.stream(["內容裡提到要改用 pgvector。"])
    job_id = uuid.uuid4()

    chunks = ask_over_grpc(ai_stub, job_id, web_search=True)

    assert chunks[1].web_sources.failed and not chunks[1].web_sources.sources
    (turn,) = ai_stub.ListQaHistory(ai_pb2.ListQaHistoryRequest(job_id=str(job_id))).turns
    assert turn.web_search and list(turn.web_sources) == []


def test_a_question_asked_without_web_search_is_kept_as_not_searched(ai_stub, db_session, fake_llm, tavily):
    fake_llm.stream(["內容裡提到要改用 pgvector。"])
    job_id = uuid.uuid4()

    chunks = ask_over_grpc(ai_stub, job_id, web_search=False)

    assert "web_sources" not in [chunk.WhichOneof("payload") for chunk in chunks]
    (turn,) = ai_stub.ListQaHistory(ai_pb2.ListQaHistoryRequest(job_id=str(job_id))).turns
    assert not turn.web_search and list(turn.web_sources) == []


@pytest.mark.parametrize("key, available", [("tvly-test-key", True), ("", False)])
def test_the_model_list_says_whether_questions_can_search_the_web(ai_stub, db_session, monkeypatch, key, available):
    monkeypatch.setattr(web_search.settings, "tavily_api_key", key)

    models = ai_stub.ListAvailableModels(ai_pb2.ListAvailableModelsRequest(user_id=str(USER)))

    assert models.web_search is available


def test_when_the_search_query_cannot_be_written_the_question_itself_is_searched(ask, tavily, fake_llm):
    tavily.found(("pgvector", "https://github.com/pgvector/pgvector", "Open-source vector similarity search"))
    fake_llm.fail(400)  # the call that writes the search query

    events, prompt = ask(web_search=True, searches=False)

    assert tavily.queries == ["他們說的 pgvector 是什麼？"]
    assert events[1][1].sources == [WebSource(title="pgvector", url="https://github.com/pgvector/pgvector")]
    assert "## 網路搜尋結果" in prompt
