"""事實查核怎麼跑（.scratch/fact-check）：標出主張（gRPC 要求與取得、背景抽取）與查核勾選的主張。真的 Postgres，RabbitMQ 換成記錄發了
什麼的假的，模型是假的 AI 廠商，逐字稿 client mock 掉。"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import select

from app.db import new_session
from app.models import Claim, LlmUsage, WebSearchUsage
from app.proto_gen import ai_pb2
from app.services import fact_checks, job_deletion
from app.services.retry import RetryableMessageError
from app.services.web_search import WebPage, WebSearchFailed, WebSource

USER = uuid.UUID("00000000-0000-0000-0000-0000000000fc")


def segment(start, speaker, text):
    return SimpleNamespace(id=str(uuid.uuid4()), start_time=start, end_time=start + 4, speaker_label=speaker, text=text)


TRANSCRIPT = SimpleNamespace(full_text="", revision=5, language="zh-TW", speakers=[
    SimpleNamespace(label="S1", display_name="主持人", display_order=1),
    SimpleNamespace(label="S2", display_name="講者 2", display_order=2),
], segments=[
    segment(0.0, "S1", "歡迎收聽本集節目"),
    segment(4.0, "S2", "台灣大概有三成的人每天聽 Podcast"),
    segment(8.0, "S1", "這個法規去年已經修改了"),
    segment(12.0, "S2", "我小時候每天都走路上學"),
])

PODCAST = {"line": 2, "quote": "三成的人每天聽 Podcast", "claim": "台灣約有 30% 的人每天收聽 Podcast", "kind": "number",
           "checkable": True}
LAW = {"line": 3, "quote": "法規去年已經修改", "claim": "某法規在去年修改", "kind": "fact", "checkable": True}
CHILDHOOD = {"line": 4, "quote": "我小時候每天都走路上學", "claim": "講者小時候每天走路上學", "kind": "fact", "checkable": False}


@pytest.fixture
def rabbitmq():
    with patch("app.services.fact_checks.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield channel


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request(stub, job_id):
    return stub.RequestFactCheck(ai_pb2.RequestFactCheckRequest(job_id=str(job_id), user_id=str(USER)))


def get(stub, job_id):
    return stub.GetFactCheck(ai_pb2.GetFactCheckRequest(job_id=str(job_id)))


def process(job_id, the_transcript=TRANSCRIPT, retry_count=0):
    with patch.object(fact_checks, "transcript_client") as client:
        client.get_transcript.return_value = the_transcript
        fact_checks.process_fact_check_requested(
            json.dumps({"jobId": str(job_id), "userId": str(USER)}).encode(), retry_count=retry_count)


def answer(fake_llm, *items):
    fake_llm.reply(json.dumps(list(items), ensure_ascii=False))


def marked_job(stub, fake_llm, *items):
    job_id = uuid.uuid4()
    request(stub, job_id)
    answer(fake_llm, *items)
    process(job_id)
    return job_id


def test_requesting_marks_it_being_found_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    found = request(ai_stub, job_id)

    assert found.status == ai_pb2.FACT_CHECK_STATUS_GENERATING
    assert published(rabbitmq) == [("fact_check.requested", {"jobId": str(job_id), "userId": str(USER)})]


def test_a_job_never_checked_has_nothing(ai_stub, db_session):
    found = get(ai_stub, uuid.uuid4())

    assert not found.HasField("extraction") and list(found.claims) == []


def test_the_claims_are_saved_in_order_with_who_said_them_and_unverified(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = marked_job(ai_stub, fake_llm, LAW, PODCAST, CHILDHOOD)

    found = get(ai_stub, job_id)
    assert found.extraction.status == ai_pb2.FACT_CHECK_STATUS_COMPLETED and found.extraction.source_revision == 5
    podcast, law, childhood = found.claims
    assert (podcast.claim, podcast.kind, podcast.speaker_label, podcast.start_time, podcast.text) == (
        "台灣約有 30% 的人每天收聽 Podcast", "number", "S2", 4.0, "台灣大概有三成的人每天聽 Podcast")
    assert (podcast.verdict, law.verdict) == ("", "")  # not checked yet
    assert childhood.verdict == "not_checkable"  # only the speaker knows: nothing to check, nothing to tick
    assert podcast.source_revision == 5
    with new_session() as session:
        assert {u.feature for u in session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id))} == {"fact_check"}


def test_finding_claims_again_keeps_the_checked_ones(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = marked_job(ai_stub, fake_llm, PODCAST, LAW)
    with new_session() as session:
        podcast = session.scalar(select(Claim).where(Claim.job_id == job_id, Claim.start_time == 4))
        podcast.verdict, podcast.explanation = "supported", "調查顯示約三成"
        session.commit()

    request(ai_stub, job_id)
    answer(fake_llm, PODCAST | {"claim": "台灣三成的人每天聽 Podcast"}, LAW | {"claim": "某法規去年修正"})
    process(job_id)

    claims = get(ai_stub, job_id).claims
    assert [(c.claim, c.verdict) for c in claims] == [("台灣約有 30% 的人每天收聽 Podcast", "supported"), ("某法規去年修正", "")]


def test_a_reply_in_the_wrong_format_fails_with_a_reason(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.reply("沒有 JSON")

    process(job_id)

    assert get(ai_stub, job_id).extraction.failure_reason == fact_checks.FORMAT_REASON


def test_a_passing_failure_is_retried_as_a_message(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = uuid.uuid4()
    request(ai_stub, job_id)
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        process(job_id)


def test_the_monthly_platform_limit_stops_it_before_asking_the_model(ai_stub, db_session, rabbitmq, fake_llm,
                                                                     monkeypatch):
    monkeypatch.setattr(fact_checks, "platform_tokens_left", lambda user_id, model: False)
    job_id = uuid.uuid4()
    request(ai_stub, job_id)

    process(job_id)

    assert get(ai_stub, job_id).extraction.failure_reason == fact_checks.LIMIT_REASON
    assert fake_llm.bodies() == []


def test_deleting_the_job_deletes_its_claims(ai_stub, db_session, rabbitmq, fake_llm):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)

    job_deletion.delete_job_data(job_id)

    found = get(ai_stub, job_id)
    assert not found.HasField("extraction") and list(found.claims) == []


def page(n):
    return WebPage(WebSource(f"報告 {n}", f"https://example.org/{n}"), f"摘錄 {n}：台灣每天聽 Podcast 的人約 {20 + n}%")


@pytest.fixture
def web(monkeypatch):
    """The web search: what was searched for, and what comes back (a list of pages, or an exception) per query."""
    state = SimpleNamespace(queries=[], answers={})

    def search(query):
        state.queries.append(query)
        answer = state.answers.get(query, [])
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(fact_checks.web_search, "search", search)
    monkeypatch.setattr(fact_checks.web_search, "is_available", lambda: True)
    return state


def check(stub, job_id, claim_ids):
    return stub.CheckClaims(ai_pb2.CheckClaimsRequest(job_id=str(job_id), user_id=str(USER), claim_ids=claim_ids))


def process_check(job_id, claim_ids):
    fact_checks.process_claim_check_requested(
        json.dumps({"jobId": str(job_id), "userId": str(USER), "claimIds": claim_ids}).encode())


def ids(stub, job_id):
    return {c.claim: c.id for c in get(stub, job_id).claims}


def test_checking_claims_marks_them_being_checked_and_queues_them(ai_stub, db_session, rabbitmq, fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST, LAW)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    rabbitmq.reset_mock()

    found = check(ai_stub, job_id, [claim_id])

    assert [c.checking for c in found.claims] == [True, False]
    assert published(rabbitmq) == [("claim_check.requested", {"jobId": str(job_id), "userId": str(USER), "claimIds": [claim_id]})]


def test_what_cannot_be_checked_is_refused(ai_stub, db_session, rabbitmq, fake_llm, web, monkeypatch):
    job_id = marked_job(ai_stub, fake_llm, PODCAST, CHILDHOOD)
    claim_ids = ids(ai_stub, job_id)

    with pytest.raises(grpc.RpcError) as not_checkable:
        check(ai_stub, job_id, [claim_ids[CHILDHOOD["claim"]]])
    with pytest.raises(grpc.RpcError) as elsewhere:
        check(ai_stub, uuid.uuid4(), [claim_ids[PODCAST["claim"]]])
    monkeypatch.setattr(fact_checks.web_search, "is_available", lambda: False)
    with pytest.raises(grpc.RpcError) as no_search:
        check(ai_stub, job_id, [claim_ids[PODCAST["claim"]]])

    assert not_checkable.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert elsewhere.value.code() == grpc.StatusCode.NOT_FOUND
    assert no_search.value.code() == grpc.StatusCode.FAILED_PRECONDITION


def test_a_claim_is_searched_for_alone_and_judged_only_on_the_pages_found(ai_stub, db_session, rabbitmq, fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])
    web.answers[PODCAST["claim"]] = [page(1), page(2)]
    fake_llm.reply('{"verdict": "disputed", "explanation": "調查顯示約 22%，不是三成 [2]。", "sources": [2]}')

    process_check(job_id, [claim_id])

    assert web.queries == [PODCAST["claim"]]  # the claim's own sentence, nothing from the transcript
    prompt = fake_llm.bodies()[1]["messages"][0]["content"]
    assert "[1] 報告 1" in prompt and "摘錄 2" in prompt and PODCAST["claim"] in prompt
    assert "只能根據" in prompt and "no_reliable_source" in prompt
    [checked] = get(ai_stub, job_id).claims
    # Only the cited page is kept, so its number in the explanation is its place among the kept sources.
    assert (checked.verdict, checked.explanation, checked.checking) == ("disputed", "調查顯示約 22%，不是三成 [1]。", False)
    assert [(s.title, s.url) for s in checked.sources] == [("報告 2", "https://example.org/2")]
    assert checked.checked_at.seconds > 0
    with new_session() as session:
        usage = session.scalars(select(WebSearchUsage).where(WebSearchUsage.job_id == job_id)).all()
        assert [(u.feature, u.succeeded) for u in usage] == [("fact_check", True)]


def test_the_sources_are_numbered_as_the_explanation_cites_them(ai_stub, db_session, rabbitmq, fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])
    web.answers[PODCAST["claim"]] = [page(1), page(2), page(3), page(4)]
    fake_llm.reply('{"verdict": "supported", "explanation": "兩份調查都說約三成 [4]，跟另一份一致 [2]，網路上也有人這樣說 [3]。",'
                   ' "sources": [2, 4]}')

    process_check(job_id, [claim_id])

    [checked] = get(ai_stub, job_id).claims
    assert checked.explanation == "兩份調查都說約三成 [1]，跟另一份一致 [2]，網路上也有人這樣說。"
    assert [s.title for s in checked.sources] == ["報告 4", "報告 2"]


def test_nothing_found_on_the_web_is_no_reliable_source_without_asking_the_model(ai_stub, db_session, rabbitmq,
                                                                                fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])

    process_check(job_id, [claim_id])

    [checked] = get(ai_stub, job_id).claims
    assert checked.verdict == "no_reliable_source" and list(checked.sources) == []
    assert len(fake_llm.bodies()) == 1  # only finding the claims


def test_a_verdict_without_a_source_cited_is_no_reliable_source(ai_stub, db_session, rabbitmq, fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])
    web.answers[PODCAST["claim"]] = [page(1)]
    fake_llm.reply('{"verdict": "supported", "explanation": "應該是對的。", "sources": [7]}')

    process_check(job_id, [claim_id])

    assert get(ai_stub, job_id).claims[0].verdict == "no_reliable_source"


def test_each_claim_succeeds_or_fails_on_its_own(ai_stub, db_session, rabbitmq, fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST, LAW)
    claim_ids = ids(ai_stub, job_id)
    check(ai_stub, job_id, list(claim_ids.values()))
    web.answers[PODCAST["claim"]] = WebSearchFailed("timeout")
    web.answers[LAW["claim"]] = [page(1)]
    fake_llm.reply('{"verdict": "supported", "explanation": "法規確實在去年修正 [1]。", "sources": [1]}')

    process_check(job_id, list(claim_ids.values()))

    podcast, law = get(ai_stub, job_id).claims
    assert (podcast.verdict, podcast.checking, podcast.check_error) == ("", False, fact_checks.SEARCH_FAILED_REASON)
    assert law.verdict == "supported"
    with new_session() as session:
        assert sorted(u.succeeded for u in session.scalars(select(WebSearchUsage).where(WebSearchUsage.job_id == job_id))) == [
            False, True]


def test_a_judgement_in_the_wrong_format_leaves_the_claim_unchecked_with_a_reason(ai_stub, db_session, rabbitmq,
                                                                                 fake_llm, web):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])
    web.answers[PODCAST["claim"]] = [page(1)]
    fake_llm.reply("不是 JSON")

    process_check(job_id, [claim_id])

    [claim] = get(ai_stub, job_id).claims
    assert (claim.verdict, claim.checking, claim.check_error) == ("", False, fact_checks.JUDGE_FAILED_REASON)
    with new_session() as session:
        assert {u.feature for u in session.scalars(select(LlmUsage).where(LlmUsage.job_id == job_id))} == {"fact_check"}


def test_no_search_is_spent_once_the_platform_model_is_used_up(ai_stub, db_session, rabbitmq, fake_llm, web, monkeypatch):
    job_id = marked_job(ai_stub, fake_llm, PODCAST)
    claim_id = ids(ai_stub, job_id)[PODCAST["claim"]]
    check(ai_stub, job_id, [claim_id])
    web.answers[PODCAST["claim"]] = [page(1)]
    monkeypatch.setattr(fact_checks, "platform_tokens_left", lambda user_id, model: False)

    process_check(job_id, [claim_id])

    [claim] = get(ai_stub, job_id).claims
    assert (claim.verdict, claim.checking, claim.check_error) == ("", False, fact_checks.LIMIT_REASON)
    assert web.queries == []
    with new_session() as session:
        assert session.scalars(select(WebSearchUsage).where(WebSearchUsage.job_id == job_id)).all() == []
