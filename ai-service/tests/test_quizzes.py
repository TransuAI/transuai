"""測驗（見 CONTEXT.md「測驗」）：gRPC 要求產生、列出、取得（真的 Postgres，RabbitMQ 換成記錄發了什麼的假的），
以及背景產生——直接呼叫處理 quiz.requested 的函式，模型是假的 AI 廠商（HTTP 層），逐字稿 client mock 掉。"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import NamedTuple
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import select

from app.db import new_session
from app.models import DefaultModel, Quiz, QuizAttempt
from app.proto_gen import ai_pb2, transcription_pb2
from app.services import quiz_generator, quizzes, usage_meter
from app.services.retry import RetryableMessageError

USER = uuid.UUID("00000000-0000-0000-0000-00000000c0de")


class FakeRabbitMQ(NamedTuple):
    connection_class: MagicMock
    channel: MagicMock


@pytest.fixture
def rabbitmq():
    """The RabbitMQ boundary used when a quiz is queued: records what was published."""
    with patch("app.services.quizzes.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield FakeRabbitMQ(connection_class, channel)


def published(channel):
    return [(c.kwargs["routing_key"], json.loads(c.kwargs["body"])) for c in channel.basic_publish.call_args_list]


def request_quiz(stub, job_id, question_count=5):
    return stub.RequestQuiz(ai_pb2.RequestQuizRequest(job_id=str(job_id), user_id=str(USER), question_count=question_count))


# --- 要求產生、列出、取得（gRPC）---


def test_requesting_a_quiz_creates_one_being_generated_and_queues_it(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()

    quiz = request_quiz(ai_stub, job_id, question_count=10)

    assert (quiz.job_id, quiz.question_count, quiz.status) == (str(job_id), 10, ai_pb2.QUIZ_STATUS_GENERATING)
    assert not quiz.HasField("completed_at")
    assert published(rabbitmq.channel) == [
        ("quiz.requested", {"quizId": quiz.id, "jobId": str(job_id), "userId": str(USER)})]


def test_a_quiz_is_saved_before_its_message_goes_out(ai_stub, db_session, rabbitmq):
    """The background work may pick the message up at once; it has to find the quiz."""
    seen = []

    def publish(**kwargs):
        session = new_session()
        try:
            seen.append(session.get(Quiz, uuid.UUID(json.loads(kwargs["body"])["quizId"])) is not None)
        finally:
            session.close()

    rabbitmq.channel.basic_publish.side_effect = publish

    request_quiz(ai_stub, uuid.uuid4())

    assert seen == [True]


@pytest.mark.parametrize("question_count", [0, 3, 15, 50])
def test_a_quiz_has_5_10_or_20_questions(ai_stub, db_session, rabbitmq, question_count):
    with pytest.raises(grpc.RpcError) as error:
        request_quiz(ai_stub, uuid.uuid4(), question_count=question_count)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert published(rabbitmq.channel) == []


def test_each_request_makes_another_quiz_listed_newest_first(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    first = request_quiz(ai_stub, job_id, question_count=5)
    second = request_quiz(ai_stub, job_id, question_count=20)
    request_quiz(ai_stub, uuid.uuid4())  # another job's

    listed = ai_stub.ListQuizzes(ai_pb2.ListQuizzesRequest(job_id=str(job_id))).quizzes

    assert [(q.id, q.question_count) for q in listed] == [(second.id, 20), (first.id, 5)]


def test_a_quiz_that_cannot_be_queued_is_not_created(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    rabbitmq.connection_class.side_effect = OSError("connection refused")

    with pytest.raises(grpc.RpcError) as error:
        request_quiz(ai_stub, job_id)

    assert error.value.code() == grpc.StatusCode.UNAVAILABLE
    assert list(ai_stub.ListQuizzes(ai_pb2.ListQuizzesRequest(job_id=str(job_id))).quizzes) == []


def test_a_quiz_generating_for_more_than_5_minutes_reads_as_failed(ai_stub, db_session, rabbitmq):
    job_id = uuid.uuid4()
    quiz = request_quiz(ai_stub, job_id)
    db_session.get(Quiz, uuid.UUID(quiz.id)).requested_at = datetime.now(timezone.utc) - timedelta(minutes=6)
    db_session.commit()

    [listed] = ai_stub.ListQuizzes(ai_pb2.ListQuizzesRequest(job_id=str(job_id))).quizzes

    assert listed.status == ai_pb2.QUIZ_STATUS_FAILED
    assert listed.failure_reason == "產生逾時，請再產生一次"


def test_a_quiz_of_another_job_is_not_found(ai_stub, db_session, rabbitmq):
    quiz = request_quiz(ai_stub, uuid.uuid4())

    with pytest.raises(grpc.RpcError) as error:
        ai_stub.GetQuiz(ai_pb2.GetQuizRequest(job_id=str(uuid.uuid4()), quiz_id=quiz.id))

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


# --- 背景產生 ---


def segment(start: float, text: str, speaker: str = "") -> transcription_pb2.TranscriptSegment:
    return transcription_pb2.TranscriptSegment(start_time=start, end_time=start + 2, text=text, speaker_label=speaker)


LECTURE = transcription_pb2.Transcript(
    revision=4,
    segments=[segment(0.0, "今天講光合作用"), segment(12.34, ""), segment(20.5, "葉綠體吸收光能")],
    speakers=[transcription_pb2.Speaker(label="S1", display_name="講者 1", display_order=1)],
)

INTERVIEW = transcription_pb2.Transcript(
    revision=1,
    segments=[segment(0.0, "你怎麼看預算", "S1"), segment(3.0, "我主張砍一成", "S2")],
    speakers=[transcription_pb2.Speaker(label="S1", display_name="主持人", display_order=1),
              transcription_pb2.Speaker(label="S2", display_name="王小明", display_order=2)],
)


def multiple_choice(timestamps=(20.5,), answer=1):
    return {"type": "multiple_choice", "question": "光能被什麼吸收？", "options": ["粒線體", "葉綠體", "細胞核", "液泡"],
            "answer": answer, "explanation": "講者說葉綠體吸收光能。", "timestamps": list(timestamps)}


def true_false(answer=True, timestamps=(0.0,)):
    return {"type": "true_false", "question": "今天講的是光合作用。", "answer": answer,
            "explanation": "開場就說了。", "timestamps": list(timestamps)}


def five_questions(**first):
    return json.dumps([multiple_choice(**first), true_false(), multiple_choice(), true_false(answer=False), multiple_choice()])


class Requested(NamedTuple):
    job_id: str
    quiz_id: str
    message: bytes


@pytest.fixture
def requested(ai_stub, db_session, rabbitmq):
    """A 5-question quiz that has been requested, and the message queued for it."""
    quiz = request_quiz(ai_stub, uuid.uuid4(), question_count=5)
    [(_, message)] = published(rabbitmq.channel)
    return Requested(quiz.job_id, quiz.id, json.dumps(message).encode())


def generate(message, transcript=LECTURE, retry_count=0):
    with patch.object(quizzes, "transcript_client") as transcript_client:
        transcript_client.get_transcript.return_value = transcript
        quizzes.process_quiz_requested(message, retry_count=retry_count)


def get_quiz(stub, requested):
    return stub.GetQuiz(ai_pb2.GetQuizRequest(job_id=requested.job_id, quiz_id=requested.quiz_id))


def test_a_generated_quiz_is_saved_with_its_questions_revision_and_model(ai_stub, requested, fake_llm):
    fake_llm.reply(five_questions())

    generate(requested.message)

    quiz = get_quiz(ai_stub, requested)
    assert (quiz.status, quiz.source_revision, quiz.model_provider, quiz.model) == (
        ai_pb2.QUIZ_STATUS_COMPLETED, 4, "platform", "Qwen/Qwen3.5-9B")
    assert quiz.HasField("completed_at")
    first, second = quiz.questions[0], quiz.questions[1]
    assert (first.kind, first.prompt, sorted(first.options), first.options[first.correct_option], first.explanation,
            list(first.source_timestamps)) == (
        "multiple_choice", "光能被什麼吸收？", sorted(["粒線體", "葉綠體", "細胞核", "液泡"]), "葉綠體", "講者說葉綠體吸收光能。",
        [20.5])
    assert (second.kind, list(second.options), second.correct_option) == ("true_false", ["是", "否"], 0)
    assert quiz.questions[3].correct_option == 1  # false → 「否」
    assert len(quiz.questions) == 5


def test_the_model_reads_each_spoken_line_with_its_start_time(requested, fake_llm):
    fake_llm.reply(five_questions())

    generate(requested.message)

    prompt = fake_llm.bodies()[0]["messages"][-1]["content"]
    assert "[0.0] 今天講光合作用\n[20.5] 葉綠體吸收光能" in prompt  # the cleared segment is left out
    assert "5" in prompt


def test_with_several_speakers_each_line_carries_the_speakers_name(requested, fake_llm):
    fake_llm.reply(json.dumps([true_false(timestamps=(3.0,))] * 5))

    generate(requested.message, transcript=INTERVIEW)

    assert "[0.0] 主持人：你怎麼看預算\n[3.0] 王小明：我主張砍一成" in fake_llm.bodies()[0]["messages"][-1]["content"]


def test_the_questions_are_asked_for_on_the_key_points_across_the_whole_content(requested, fake_llm):
    fake_llm.reply(five_questions())

    generate(requested.message)

    instructions = fake_llm.bodies()[0]["messages"][-1]["content"].split("[0.0]")[0]
    assert "知識類" in instructions and "會議" in instructions and "故事" in instructions  # questions fit the content
    assert "從頭到尾" in instructions  # a local model asked everything from the first few minutes
    assert "只有一個選項是對的" in instructions  # it once offered two right answers
    assert "錯字" in instructions  # nor about words the speech recognition got wrong


def test_the_questions_are_asked_for_in_plain_words_without_times_or_internal_terms(requested, fake_llm):
    fake_llm.reply(five_questions())

    generate(requested.message)

    instructions = fake_llm.bodies()[0]["messages"][-1]["content"].split("[0.0]")[0]
    assert "不要提到「逐字稿」" in instructions  # a local model wrote 「根據逐字稿」「在 [138.6] 這一節」
    assert "解說" in instructions and "為什麼" in instructions


def test_about_half_the_true_false_questions_are_asked_to_be_false(requested, fake_llm):
    fake_llm.reply(five_questions())

    generate(requested.message)

    assert "一半" in fake_llm.bodies()[0]["messages"][-1]["content"]  # a local model made all 30 of them true


def test_a_quiz_written_in_simplified_chinese_is_saved_in_traditional(ai_stub, requested, fake_llm):
    simplified_true_false = {**true_false(), "question": "今天讲的是光合作用。", "explanation": "开场就说了。"}
    fake_llm.reply(json.dumps([{**multiple_choice(), "question": "光能被什么吸收？", "explanation": "讲者说叶绿体吸收光能。"}]
                              + [simplified_true_false] * 4, ensure_ascii=False))

    generate(requested.message)

    first = get_quiz(ai_stub, requested).questions[0]
    assert (first.prompt, first.explanation) == ("光能被什麼吸收？", "講者說葉綠體吸收光能。")


def test_the_right_option_lands_in_different_positions(ai_stub, db_session, rabbitmq, fake_llm):
    # A local model put most right answers first or second; the options are shuffled, not left in the model's order.
    quiz = request_quiz(ai_stub, uuid.uuid4(), question_count=20)
    [(_, message)] = published(rabbitmq.channel)
    fake_llm.reply(json.dumps([multiple_choice(answer=1)] * 20))

    generate(json.dumps(message).encode())

    questions = ai_stub.GetQuiz(ai_pb2.GetQuizRequest(job_id=quiz.job_id, quiz_id=quiz.id)).questions
    assert {question.options[question.correct_option] for question in questions} == {"葉綠體"}
    assert len({question.correct_option for question in questions}) > 1


def test_timestamps_that_are_not_the_start_of_a_segment_are_dropped(ai_stub, requested, fake_llm):
    # 12.3 is the cleared segment's start (as the model saw times), 99 matches nothing, 20.5 is fine.
    fake_llm.reply(five_questions(timestamps=(12.3, 99.0, 20.5, 0.0)))

    generate(requested.message)

    assert list(get_quiz(ai_stub, requested).questions[0].source_timestamps) == [20.5, 0.0]


def test_a_timestamp_is_matched_to_the_segment_start_the_model_saw_rounded(ai_stub, requested, fake_llm):
    transcript = transcription_pb2.Transcript(revision=1, segments=[segment(7.26, "葉綠體吸收光能")])
    fake_llm.reply(five_questions(timestamps=(7.3,)))

    generate(requested.message, transcript=transcript)

    assert list(get_quiz(ai_stub, requested).questions[0].source_timestamps) == pytest.approx([7.26])


@pytest.mark.parametrize("reply", [
    "這不是 JSON",
    json.dumps([true_false()] * 4),  # 4 questions, 5 asked for
    json.dumps([multiple_choice(answer=4)] + [true_false()] * 4),  # answer outside the options
    json.dumps([{**multiple_choice(), "options": ["甲", "乙", "丙"]}] + [true_false()] * 4),  # 3 options
    json.dumps([{**multiple_choice(), "type": "essay"}] + [true_false()] * 4),
    json.dumps([{**true_false(), "answer": "是"}] + [true_false()] * 4),
    json.dumps([{**multiple_choice(), "question": ""}] + [true_false()] * 4),
])
def test_a_reply_in_the_wrong_format_fails_the_quiz_without_retrying(ai_stub, requested, fake_llm, reply):
    fake_llm.reply(reply)

    generate(requested.message, retry_count=0)  # no RetryableMessageError

    quiz = get_quiz(ai_stub, requested)
    assert quiz.status == ai_pb2.QUIZ_STATUS_FAILED
    assert quiz.failure_reason.startswith("模型回傳的測驗格式不正確")
    assert list(quiz.questions) == []


def test_a_transient_failure_asks_for_a_retry_and_keeps_the_quiz_generating(ai_stub, requested, fake_llm):
    fake_llm.fail(503)

    with pytest.raises(RetryableMessageError):
        generate(requested.message, retry_count=0)

    assert get_quiz(ai_stub, requested).status == ai_pb2.QUIZ_STATUS_GENERATING


def test_once_retries_run_out_the_quiz_fails_with_the_reason(ai_stub, requested, fake_llm):
    fake_llm.fail(503)

    generate(requested.message, retry_count=2)

    quiz = get_quiz(ai_stub, requested)
    assert quiz.status == ai_pb2.QUIZ_STATUS_FAILED
    assert quiz.failure_reason.startswith("平台模型（Qwen/Qwen3.5-9B）")


def test_a_default_model_without_its_key_fails_rather_than_using_the_platform_model(
        ai_stub, requested, fake_llm, db_session):
    db_session.add(DefaultModel(user_id=USER, provider="openai", model="gpt-5", supports_tools=True))
    db_session.commit()

    generate(requested.message)

    quiz = get_quiz(ai_stub, requested)
    assert quiz.status == ai_pb2.QUIZ_STATUS_FAILED
    assert "openai" in quiz.failure_reason
    assert fake_llm.requests == []


def test_generating_a_quiz_records_its_usage_under_the_requester(requested, fake_llm):
    fake_llm.reply(five_questions(), usage=(900, 400))

    with patch.object(usage_meter, "save_llm_usage") as save_llm_usage:
        generate(requested.message)

    [record] = [c.args[0] for c in save_llm_usage.call_args_list]
    assert (record.feature, record.user_id, record.input_tokens, record.output_tokens) == ("quiz", USER, 900, 400)


def test_a_message_delivered_again_after_the_quiz_is_done_changes_nothing(ai_stub, requested, fake_llm):
    fake_llm.reply(five_questions())
    generate(requested.message)

    generate(requested.message)  # RabbitMQ delivers at least once

    assert len(get_quiz(ai_stub, requested).questions) == 5
    assert len(fake_llm.requests) == 1  # the model isn't asked again


# --- 作答（gRPC）---


@pytest.fixture
def completed(ai_stub, requested, fake_llm):
    """The requested quiz, generated: correct options are 1, 0, 1, 1, 1 (see five_questions; options kept in the model's order
    rather than shuffled)."""
    fake_llm.reply(five_questions())
    with patch.object(quiz_generator.random, "sample", lambda population, k: list(population)):
        generate(requested.message)
    return requested


def submit(stub, quiz, answers, user_id=USER):
    return stub.SubmitQuizAttempt(ai_pb2.SubmitQuizAttemptRequest(
        job_id=quiz.job_id, quiz_id=quiz.quiz_id, user_id=str(user_id), answers=answers))


def test_an_attempt_is_scored_question_by_question(ai_stub, completed):
    result = submit(ai_stub, completed, [1, 1, 0, 1, 1])

    assert (result.correct_count, result.question_count) == (3, 5)
    assert [(r.chosen_option, r.correct_option, r.correct) for r in result.results] == [
        (1, 1, True), (1, 0, False), (0, 1, False), (1, 1, True), (1, 1, True)]
    assert result.results[0].explanation == "講者說葉綠體吸收光能。"


def test_every_attempt_is_kept_and_the_list_shows_the_best_one(ai_stub, completed):
    listed = lambda: ai_stub.ListQuizzes(ai_pb2.ListQuizzesRequest(job_id=completed.job_id)).quizzes[0]
    assert not listed().HasField("best_correct_count")

    submit(ai_stub, completed, [1, 0, 1, 1, 1])  # 5
    submit(ai_stub, completed, [0, 0, 0, 0, 0])  # 1

    assert listed().best_correct_count == 5
    assert get_quiz(ai_stub, completed).best_correct_count == 5
    session = new_session()
    try:
        attempts = session.scalars(select(QuizAttempt).where(QuizAttempt.quiz_id == uuid.UUID(completed.quiz_id))).all()
        assert sorted((a.correct_count, a.answers, a.user_id) for a in attempts) == [
            (1, [0, 0, 0, 0, 0], USER), (5, [1, 0, 1, 1, 1], USER)]
    finally:
        session.close()


@pytest.mark.parametrize("answers", [[1, 0, 1, 1], [1, 0, 1, 1, 1, 0], [1, 2, 1, 1, 1], [4, 0, 1, 1, 1], [-1, 0, 1, 1, 1]])
def test_an_attempt_needs_one_valid_option_per_question(ai_stub, completed, answers):
    with pytest.raises(grpc.RpcError) as error:
        submit(ai_stub, completed, answers)  # a true/false question only has options 0 and 1

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_quiz_still_being_generated_cannot_be_answered(ai_stub, requested):
    with pytest.raises(grpc.RpcError) as error:
        submit(ai_stub, requested, [0, 0, 0, 0, 0])

    assert error.value.code() == grpc.StatusCode.FAILED_PRECONDITION


def test_answering_a_quiz_of_another_job_is_not_found(ai_stub, completed):
    with pytest.raises(grpc.RpcError) as error:
        ai_stub.SubmitQuizAttempt(ai_pb2.SubmitQuizAttemptRequest(
            job_id=str(uuid.uuid4()), quiz_id=completed.quiz_id, user_id=str(USER), answers=[1, 0, 1, 1, 1]))

    assert error.value.code() == grpc.StatusCode.NOT_FOUND
