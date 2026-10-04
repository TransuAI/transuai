"""決策紀錄怎麼跑（.scratch/decision-log/issues/01）：gRPC 要求與取得（真的 Postgres，RabbitMQ 換成記錄發了什麼的假的），背景抽取——
直接呼叫處理 decision.requested 的函式，模型是假的 AI 廠商，逐字稿 client 與 embedding mock 掉——以及轉錄完自動抽。"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import select

from app.db import new_session
from app.models import Decision, LlmUsage
from app.proto_gen import ai_pb2
from app.services import decisions, job_deletion
from app.services.llm_client import platform_chat_model
from app.services.retry import RetryableMessageError

USER = uuid.UUID("00000000-0000-0000-0000-0000000000dc")


def segment(start, speaker, text):
    return SimpleNamespace(id=str(uuid.uuid4()), start_time=start, end_time=start + 4, speaker_label=speaker, text=text)


TRANSCRIPT = SimpleNamespace(full_text="", revision=7, language="zh-TW", speakers=[
    SimpleNamespace(label="S1", display_name="主持人", display_order=1),
    SimpleNamespace(label="S2", display_name="講者 2", display_order=2),
], segments=[
    segment(0.0, "S1", "今天要決定資料庫"),
    segment(4.0, "S2", "我覺得用 PostgreSQL 因為需要 pgvector"),
    segment(8.0, "S1", "好 那就決定用 PostgreSQL"),
    segment(12.0, "S2", "上線日期先訂月底 下週再確認"),
])

POSTGRES = {"statement": "資料庫用 PostgreSQL", "rationale": "需要 pgvector", "alternatives": ["MySQL"],
            "proposed_by": "主持人", "tentative": False, "line": 3, "quote": "那就決定用 PostgreSQL"}
LAUNCH = {"statement": "上線日期暫定月底", "rationale": "", "alternatives": [], "proposed_by": "講者 2",
          "tentative": True, "line": 4, "quote": "上線日期先訂月底"}


@pytest.fixture
def rabbitmq():
    with patch("app.services.decisions.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield channel


@pytest.fixture
def embedder():
    with patch.object(decisions, "embed_documents") as embed:
        embed.side_effect = lambda texts: [[0.1] * 1024 for _ in texts]
        yield embed


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request(stub, job_id):
    return stub.RequestDecisionExtraction(ai_pb2.RequestDecisionExtractionRequest(job_id=str(job_id), user_id=str(USER)))


def get(stub, job_id):
    return stub.GetJobDecisions(ai_pb2.GetJobDecisionsRequest(job_id=str(job_id)))


def process(job_id, retry_count=0):
    with patch.object(decisions, "transcript_client") as client:
        client.get_transcript.return_value = TRANSCRIPT
        decisions.process_decisions_requested(
            json.dumps({"jobId": str(job_id), "userId": str(USER)}).encode(), retry_count=retry_count)


def answer(fake_llm, *items):
    fake_llm.reply(json.dumps(list(items), ensure_ascii=False))


def test_requesting_marks_it_being_extracted_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    extraction = request(ai_stub, job_id)

    assert extraction.status == ai_pb2.DECISION_EXTRACTION_STATUS_GENERATING
    assert published(rabbitmq) == [("decision.requested", {"jobId": str(job_id), "userId": str(USER)})]


def test_a_job_never_extracted_has_no_extraction_and_no_decisions(ai_stub, db_session):
    found = get(ai_stub, uuid.uuid4())

    assert not found.HasField("extraction") and list(found.decisions) == []


def test_the_grounded_decisions_are_saved_in_time_order_with_their_embedding(ai_stub, db_session, rabbitmq, fake_llm,
                                                                             embedder):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, LAUNCH, POSTGRES)

    process(job_id)

    found = get(ai_stub, job_id)
    assert found.extraction.status == ai_pb2.DECISION_EXTRACTION_STATUS_COMPLETED
    assert found.extraction.source_revision == 7
    first, second = found.decisions
    assert (first.statement, first.rationale, list(first.alternatives), first.proposed_by, first.tentative) == (
        "資料庫用 PostgreSQL", "需要 pgvector", ["MySQL"], "S1", False)
    assert (first.start_time, first.evidence_text, first.source, first.edited) == (8.0, "好 那就決定用 PostgreSQL", "ai", False)
    assert (second.statement, second.tentative, second.proposed_by) == ("上線日期暫定月底", True, "S2")
    assert embedder.call_args.args[0] == ["資料庫用 PostgreSQL\n需要 pgvector", "上線日期暫定月底"]
    with new_session() as session:
        assert {d.user_id for d in session.scalars(select(Decision).where(Decision.job_id == job_id))} == {USER}
        assert {u.feature for u in session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id))} == {
            "decision_extraction"}


def test_extracting_again_replaces_what_the_ai_found_but_keeps_what_the_user_changed_or_added(
        ai_stub, db_session, rabbitmq, fake_llm, embedder):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES, LAUNCH)
    process(job_id)
    with new_session() as session:
        launch = session.scalar(select(Decision).where(Decision.job_id == job_id, Decision.tentative.is_(True)))
        launch.statement, launch.edited = "上線日期定在月底", True
        session.add(Decision(job_id=job_id, user_id=USER, statement="週會改到週三", source="user"))
        session.commit()

    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES | {"statement": "資料庫確定用 PostgreSQL"})
    process(job_id)

    assert [d.statement for d in get(ai_stub, job_id).decisions] == ["資料庫確定用 PostgreSQL", "上線日期定在月底", "週會改到週三"]


def test_a_reply_in_the_wrong_format_fails_with_a_reason_and_keeps_the_earlier_decisions(
        ai_stub, db_session, rabbitmq, fake_llm, embedder):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES)
    process(job_id)

    request(ai_stub, job_id)
    fake_llm.reply("沒有 JSON")
    process(job_id)

    found = get(ai_stub, job_id)
    assert found.extraction.status == ai_pb2.DECISION_EXTRACTION_STATUS_FAILED
    assert found.extraction.failure_reason == decisions.FORMAT_REASON
    assert [d.statement for d in found.decisions] == ["資料庫用 PostgreSQL"]


def test_a_passing_failure_is_retried_as_a_message(ai_stub, db_session, rabbitmq, fake_llm, embedder):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        process(job_id)


def test_the_monthly_platform_limit_stops_it_before_asking_the_model(ai_stub, db_session, rabbitmq, fake_llm, embedder,
                                                                     monkeypatch):
    monkeypatch.setattr(decisions, "platform_tokens_left", lambda user_id, model: False)
    job_id = uuid.uuid4()
    request(ai_stub, job_id)

    process(job_id)

    assert get(ai_stub, job_id).extraction.failure_reason == decisions.LIMIT_REASON
    assert fake_llm.bodies() == []


def test_decisions_are_still_saved_when_the_embedding_service_is_down_for_good(ai_stub, db_session, rabbitmq, fake_llm,
                                                                               embedder):
    embedder.side_effect = RuntimeError("HF is down")
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES)

    process(job_id)

    assert [d.statement for d in get(ai_stub, job_id).decisions] == ["資料庫用 PostgreSQL"]
    with new_session() as session:
        assert session.scalar(select(Decision.embedding).where(Decision.job_id == job_id)) is None


@pytest.mark.parametrize("category, user, tokens_left, queued", [
    ("meeting", USER, True, True),
    ("interview", USER, True, True),
    ("lecture", USER, True, False),
    ("meeting", None, True, False),  # an old message without the owner
    ("meeting", USER, False, False),  # over the monthly limit: skipped, can be extracted by hand later
])
def test_meetings_and_interviews_are_extracted_once_transcribed(db_session, rabbitmq, monkeypatch, category, user,
                                                               tokens_left, queued):
    monkeypatch.setattr(decisions, "platform_tokens_left", lambda user_id, model: tokens_left)
    job_id = uuid.uuid4()

    decisions.extract_after_transcription(job_id, user, category, platform_chat_model())

    assert published(rabbitmq) == ([("decision.requested", {"jobId": str(job_id), "userId": str(USER)})] if queued else [])


def test_deleting_the_job_deletes_its_decisions(ai_stub, db_session, rabbitmq, fake_llm, embedder):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES)
    process(job_id)

    job_deletion.delete_job_data(job_id)

    found = get(ai_stub, job_id)
    assert not found.HasField("extraction") and list(found.decisions) == []


def test_a_decision_superseding_one_from_a_deleted_job_loses_the_link(db_session):
    earlier_job, later_job = uuid.uuid4(), uuid.uuid4()
    with new_session() as session:
        earlier = Decision(job_id=earlier_job, user_id=USER, statement="資料庫用 MySQL")
        session.add(earlier)
        session.flush()
        later = Decision(job_id=later_job, user_id=USER, statement="資料庫改用 PostgreSQL", supersedes_id=earlier.id)
        session.add(later)
        session.commit()
        later_id = later.id

    job_deletion.delete_job_data(earlier_job)

    with new_session() as session:
        assert session.get(Decision, later_id).supersedes_id is None


def fields(**overrides):
    values = {"statement": "週會改到週三", "rationale": "週一大家都在趕進度", "alternatives": ["週五"], "proposed_by": "S1",
              "tentative": False} | overrides
    return ai_pb2.DecisionInput(**values)


def create(stub, job_id, start_time=None, **overrides):
    request = ai_pb2.CreateDecisionRequest(job_id=str(job_id), user_id=str(USER), decision=fields(**overrides))
    if start_time is not None:
        request.start_time = start_time
    return stub.CreateDecision(request)


def extracted_job(ai_stub, fake_llm, *items):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    answer(fake_llm, *items)
    process(job_id)
    return job_id


def test_a_decision_the_user_adds_is_theirs_and_found_by_its_meaning(ai_stub, db_session, rabbitmq, embedder):
    job_id = uuid.uuid4()

    added = create(ai_stub, job_id, start_time=12.0)

    assert (added.statement, added.source, added.start_time, list(added.alternatives)) == ("週會改到週三", "user", 12.0, ["週五"])
    assert [d.id for d in get(ai_stub, job_id).decisions] == [added.id]
    assert embedder.call_args.args[0] == ["週會改到週三\n週一大家都在趕進度"]
    with new_session() as session:
        assert session.get(Decision, uuid.UUID(added.id)).user_id == USER


def test_a_decision_without_a_time_is_fine_but_one_without_a_statement_is_not(ai_stub, db_session, rabbitmq, embedder):
    assert not create(ai_stub, uuid.uuid4()).HasField("start_time")

    for bad in ({"statement": "  "}, {"statement": "長" * 301}, {"alternatives": ["x"] * 11}):
        with pytest.raises(grpc.RpcError) as error:
            create(ai_stub, uuid.uuid4(), **bad)
        assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_editing_an_extracted_decision_marks_it_edited_and_extracting_again_keeps_it_without_a_copy(
        ai_stub, db_session, rabbitmq, fake_llm, embedder):
    job_id = extracted_job(ai_stub, fake_llm, POSTGRES)
    [postgres] = get(ai_stub, job_id).decisions

    edited = ai_stub.UpdateDecision(ai_pb2.UpdateDecisionRequest(
        job_id=str(job_id), decision_id=postgres.id,
        decision=fields(statement="資料庫確定用 PostgreSQL 16", rationale="需要 pgvector", alternatives=[], proposed_by="S2",
                        tentative=True)))

    assert (edited.statement, edited.edited, edited.tentative, edited.proposed_by) == ("資料庫確定用 PostgreSQL 16", True, True, "S2")
    assert (edited.start_time, edited.evidence_text) == (8.0, "好 那就決定用 PostgreSQL")  # where it was made stays
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES, LAUNCH)  # the same decision comes back, in the same segment
    process(job_id)
    assert [d.statement for d in get(ai_stub, job_id).decisions] == ["資料庫確定用 PostgreSQL 16", "上線日期暫定月底"]


def test_a_deleted_extracted_decision_does_not_come_back_when_extracting_again(ai_stub, db_session, rabbitmq, fake_llm,
                                                                               embedder):
    job_id = extracted_job(ai_stub, fake_llm, POSTGRES, LAUNCH)
    postgres = get(ai_stub, job_id).decisions[0]

    ai_stub.DeleteDecision(ai_pb2.DeleteDecisionRequest(job_id=str(job_id), decision_id=postgres.id))

    assert [d.statement for d in get(ai_stub, job_id).decisions] == ["上線日期暫定月底"]
    request(ai_stub, job_id)
    answer(fake_llm, POSTGRES, LAUNCH)
    process(job_id)
    assert [d.statement for d in get(ai_stub, job_id).decisions] == ["上線日期暫定月底"]


def test_a_decision_the_user_added_is_deleted_for_good(ai_stub, db_session, rabbitmq, embedder):
    job_id = uuid.uuid4()
    added = create(ai_stub, job_id)

    ai_stub.DeleteDecision(ai_pb2.DeleteDecisionRequest(job_id=str(job_id), decision_id=added.id))

    with new_session() as session:
        assert session.get(Decision, uuid.UUID(added.id)) is None


def test_a_decision_of_another_job_is_not_found(ai_stub, db_session, rabbitmq, embedder):
    added = create(ai_stub, uuid.uuid4())
    other_job = str(uuid.uuid4())

    for call in (
        lambda: ai_stub.UpdateDecision(ai_pb2.UpdateDecisionRequest(job_id=other_job, decision_id=added.id, decision=fields())),
        lambda: ai_stub.DeleteDecision(ai_pb2.DeleteDecisionRequest(job_id=other_job, decision_id=added.id)),
    ):
        with pytest.raises(grpc.RpcError) as error:
            call()
        assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_a_decision_is_saved_even_when_its_embedding_cannot_be_made(ai_stub, db_session, rabbitmq, embedder):
    embedder.side_effect = RuntimeError("HF is down")

    added = create(ai_stub, uuid.uuid4())

    with new_session() as session:
        assert session.get(Decision, uuid.UUID(added.id)).embedding is None


OTHER_USER = uuid.UUID("00000000-0000-0000-0000-0000000000ee")


def stored(job_id, statement, *, user=USER, start_time=None, embedding=None, dismissed=False, rationale=""):
    with new_session() as session:
        decision = Decision(job_id=job_id, user_id=user, statement=statement, rationale=rationale, start_time=start_time,
                            embedding=embedding, dismissed=dismissed)
        session.add(decision)
        session.commit()
        return str(decision.id)


def axis(i):
    return [1.0 if n == i else 0.0 for n in range(1024)]


def listed(stub, job_ids, user=USER):
    return [d.statement for d in stub.ListUserDecisions(
        ai_pb2.ListUserDecisionsRequest(user_id=str(user), job_ids=[str(j) for j in job_ids])).decisions]


def searched(stub, query, job_ids, user=USER):
    return [d.statement for d in stub.SearchDecisions(
        ai_pb2.SearchDecisionsRequest(user_id=str(user), query=query, job_ids=[str(j) for j in job_ids])).decisions]


def test_a_users_decisions_across_their_jobs_and_only_theirs(ai_stub, db_session):
    first, second, not_asked = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    stored(first, "資料庫用 PostgreSQL", start_time=8)
    stored(first, "上線日期定在月底", start_time=2)
    stored(second, "週會改到週三")
    stored(second, "抽錯的", dismissed=True)
    stored(not_asked, "別的 Job 的")
    stored(first, "別人的決策", user=OTHER_USER)

    assert listed(ai_stub, [first, second]) == ["上線日期定在月底", "資料庫用 PostgreSQL", "週會改到週三"]
    assert listed(ai_stub, []) == []


def test_searching_finds_the_words_and_the_meaning_closest_first(ai_stub, db_session):
    job = uuid.uuid4()
    stored(job, "資料庫用 PostgreSQL", rationale="需要 pgvector", embedding=axis(0))
    stored(job, "向量檢索放在同一個資料庫", embedding=[0.8 if n == 0 else (0.6 if n == 1 else 0.0) for n in range(1024)])
    stored(job, "週會改到週三", embedding=axis(1))
    stored(job, "PostgreSQL 的備份每天一次", embedding=axis(2))
    stored(job, "別人的 PostgreSQL 決策", user=OTHER_USER, embedding=axis(0))

    with patch.object(decisions, "embed_query", return_value=axis(0)):
        found = searched(ai_stub, "postgresql", [job])

    # The words first (closest in meaning among them first), then what only means the same; 週會 is neither.
    assert found == ["資料庫用 PostgreSQL", "PostgreSQL 的備份每天一次", "向量檢索放在同一個資料庫"]


def test_searching_still_finds_the_words_when_the_embedding_service_is_down(ai_stub, db_session):
    job = uuid.uuid4()
    stored(job, "資料庫用 PostgreSQL", embedding=axis(0))
    stored(job, "週會改到週三", embedding=axis(1))

    with patch.object(decisions, "embed_query", side_effect=RuntimeError("HF is down")):
        assert searched(ai_stub, "PostgreSQL", [job]) == ["資料庫用 PostgreSQL"]


def test_searching_for_percent_signs_is_not_a_wildcard(ai_stub, db_session):
    job = uuid.uuid4()
    stored(job, "毛利率目標 40%")
    stored(job, "週會改到週三")

    with patch.object(decisions, "embed_query", side_effect=RuntimeError("no embeddings")):
        assert searched(ai_stub, "%", [job]) == ["毛利率目標 40%"]
