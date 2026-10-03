"""Job 在 upload-service 刪掉之後（`job.deleted`）清掉這個服務的資料；刪除時還在跑的寫入晚到也不留資料；用量不刪
（見 .scratch/account-deletion/issues/01）。"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from app.db import new_session
from app.models import (ActionProposal, Chapter, Embedding, LlmUsage, PostMeetingRun, QaHistory, Quiz, QuizAttempt,
                        QuizQuestion, SpeakerSuggestion, Summary, WebSearchUsage)
from app.services import deletion_consumer, job_deletion


def fill(job_id: uuid.UUID) -> None:
    """一個 Job 在 ai_db 裡會有的每一種資料，各一筆。"""
    user = uuid.uuid4()
    with new_session() as session:
        quiz = Quiz(job_id=job_id, user_id=user, question_count=1, status="READY")
        run = PostMeetingRun(job_id=job_id, user_id=user, status="READY", timezone="Asia/Taipei",
                             uploaded_at=datetime.now(timezone.utc))
        session.add_all([
            Summary(job_id=job_id, summary_text="摘要"),
            Chapter(job_id=job_id, title="開場", start_time=0, sequence_no=1),
            Embedding(job_id=job_id, chunk_text="大家好", embedding=[0.0] * 1024),
            QaHistory(job_id=job_id, user_id=user, question="?", answer="!", source_timestamps=[]),
            quiz, run,
            SpeakerSuggestion(job_id=job_id, speaker_label="1", name="王小明", evidence_start_time=0, evidence_text="我是王小明"),
            LlmUsage(job_id=job_id, user_id=user, feature="summary", provider="hf", model="m", key_source="platform", succeeded=True),
            WebSearchUsage(job_id=job_id, user_id=user, provider="tavily", succeeded=True),
        ])
        session.flush()
        session.add_all([
            QuizQuestion(quiz_id=quiz.id, position=1, kind="single", prompt="?", options=["a", "b"], correct_option=0,
                         explanation="", source_timestamps=[]),
            QuizAttempt(quiz_id=quiz.id, user_id=user, answers=[0], correct_count=1),
            ActionProposal(run_id=run.id, position=1, service="google", tool="create_event", kind="calendar", arguments={}),
        ])
        session.commit()


def counts(job_id: uuid.UUID) -> dict[str, int]:
    with new_session() as session:
        result = {model.__name__: session.scalar(select(func.count()).select_from(model).where(model.job_id == job_id))
                  for model in (*job_deletion.JOB_SCOPED, LlmUsage, WebSearchUsage)}
        result["QuizQuestion"] = session.scalar(select(func.count()).select_from(QuizQuestion).join(Quiz).where(Quiz.job_id == job_id))
        result["QuizAttempt"] = session.scalar(select(func.count()).select_from(QuizAttempt).join(Quiz).where(Quiz.job_id == job_id))
        result["ActionProposal"] = session.scalar(
            select(func.count()).select_from(ActionProposal).join(PostMeetingRun).where(PostMeetingRun.job_id == job_id))
        return result


USAGE = {"LlmUsage", "WebSearchUsage"}


@pytest.fixture
def two_jobs(db_session):
    deleted, kept = uuid.uuid4(), uuid.uuid4()
    fill(deleted)
    fill(kept)
    return deleted, kept


def test_everything_of_the_deleted_job_is_removed_except_usage_and_other_jobs_are_untouched(two_jobs):
    deleted, kept = two_jobs
    assert all(n > 0 for n in counts(deleted).values())

    job_deletion.delete_job_data(deleted)

    remaining = counts(deleted)
    assert {name: n for name, n in remaining.items() if name not in USAGE} == {
        name: 0 for name in remaining if name not in USAGE}
    assert remaining["LlmUsage"] == 1 and remaining["WebSearchUsage"] == 1
    assert all(n == 1 for n in counts(kept).values())


def test_handling_the_same_event_twice_is_fine(two_jobs):
    deleted, _ = two_jobs

    job_deletion.delete_job_data(deleted)
    job_deletion.delete_job_data(deleted)

    assert counts(deleted)["Summary"] == 0


def test_data_written_after_the_deletion_is_discarded_by_the_write_guard(db_session):
    job_id = uuid.uuid4()
    job_deletion.delete_job_data(job_id)  # 刪除先到

    fill(job_id)  # pipeline、出題、問答……晚一步寫入：commit 之後 guard 發現 Job 已刪

    remaining = counts(job_id)
    assert {name: n for name, n in remaining.items() if name not in USAGE} == {
        name: 0 for name in remaining if name not in USAGE}


def test_an_update_of_data_already_deleted_fails_and_brings_nothing_back(db_session):
    from sqlalchemy.orm.exc import StaleDataError
    job_id = uuid.uuid4()
    with new_session() as session:
        session.add(Summary(job_id=job_id, summary_text="舊的"))
        session.commit()
    with new_session() as session:
        summary = session.scalar(select(Summary).where(Summary.job_id == job_id))
        job_deletion.delete_job_data(job_id)  # 重新產生摘要讀到之後、寫回之前，Job 被刪了
        summary.summary_text = "新的"
        with pytest.raises(StaleDataError):
            session.commit()

    assert counts(job_id)["Summary"] == 0


def test_writes_for_jobs_that_were_not_deleted_are_kept(db_session):
    job_id = uuid.uuid4()

    fill(job_id)

    assert all(n == 1 for n in counts(job_id).values())


class TestConsumer:
    def test_a_handled_message_is_acked(self):
        handled = []
        sub = deletion_consumer.Subscription("job.deleted", "q", "q.retry", handled.append)
        channel = MagicMock()

        deletion_consumer.handle(channel, 7, json.dumps({"jobId": str(uuid.uuid4())}).encode(), sub)

        assert len(handled) == 1
        channel.basic_ack.assert_called_once_with(delivery_tag=7)

    @pytest.mark.parametrize("body", [b"not json", b"[]", b'{"userId":"x"}'])
    def test_an_invalid_message_is_dropped(self, body):
        channel = MagicMock()

        deletion_consumer.handle(channel, 7, body, deletion_consumer.subscriptions()[0])

        channel.basic_ack.assert_called_once_with(delivery_tag=7)
        channel.basic_nack.assert_not_called()

    def test_a_failure_goes_to_the_retry_queue(self):
        def broken(_payload):
            raise RuntimeError("database down")
        channel = MagicMock()

        deletion_consumer.handle(channel, 7, b'{"jobId":"00000000-0000-0000-0000-000000000001"}',
                                 deletion_consumer.Subscription("job.deleted", "q", "q.retry", broken))

        channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
