import json
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest
from huggingface_hub.errors import HfHubHTTPError
from sqlalchemy import select

from app.models import Chapter, Summary
from app.repositories.chapter_repository import save_chapters
from app.repositories.summary_repository import save_summary
from app.services import regeneration
from app.services.job_status_client import job_status_client
from app.services.retry import RetryableMessageError

EDITED_TRANSCRIPT = SimpleNamespace(
    full_text="大家好\n今天開會討論預算",
    revision=3,
    segments=[
        SimpleNamespace(start_time=0.0, end_time=1.5, text="大家好"),
        SimpleNamespace(start_time=1.5, end_time=3.0, text=""),
        SimpleNamespace(start_time=3.0, end_time=6.0, text="今天開會討論預算"),
    ],
    speakers=[],
)


@pytest.fixture
def job(db_session):
    """A job whose summary and chapters are 過時 and whose regeneration has been requested."""
    job_id = uuid.uuid4()
    summary = save_summary(db_session, job_id, "舊摘要", source_revision=0)
    summary.regeneration_status = "RUNNING"
    db_session.commit()
    save_chapters(db_session, job_id, [("舊章節", 0.0)])
    return job_id


def run(job_id, summarize=lambda text: "新摘要", retry_count=0):
    with (
        patch.object(regeneration, "transcript_client") as transcript_client,
        patch.object(regeneration, "summarize", side_effect=summarize) as summarize_mock,
        patch.object(regeneration, "generate_chapters", return_value=[("開場", 0.0), ("預算", 3.0)]) as chapters_mock,
    ):
        transcript_client.get_transcript.return_value = EDITED_TRANSCRIPT
        regeneration.process_regeneration_requested(json.dumps({"jobId": str(job_id)}).encode(), retry_count=retry_count)
    return summarize_mock, chapters_mock


def state(db_session, job_id):
    db_session.expire_all()
    summary = db_session.scalar(select(Summary).where(Summary.job_id == job_id))
    chapters = [c.title for c in db_session.scalars(select(Chapter).where(Chapter.job_id == job_id).order_by(Chapter.sequence_no))]
    return summary.summary_text, summary.source_revision, summary.regeneration_status, chapters


def test_regenerating_replaces_summary_and_chapters_from_the_current_transcript(db_session, job):
    summarize, generate_chapters = run(job)

    summarize.assert_called_once_with("大家好\n今天開會討論預算")
    assert [s.text for s in generate_chapters.call_args.args[0]] == ["大家好", "今天開會討論預算"]  # no cleared segment
    assert state(db_session, job) == ("新摘要", 3, "IDLE", ["開場", "預算"])


def _overloaded(_text):
    response = httpx.Response(503, request=httpx.Request("POST", "https://example.invalid"))
    raise HfHubHTTPError("hf", response=response)


def test_a_transient_failure_asks_for_a_retry_and_leaves_everything_as_it_was(db_session, job):
    with pytest.raises(RetryableMessageError):
        run(job, summarize=_overloaded)

    assert state(db_session, job) == ("舊摘要", 0, "RUNNING", ["舊章節"])


def test_a_failed_regeneration_keeps_the_old_content_and_never_touches_the_job(db_session, job):
    with patch.object(job_status_client, "update_status") as update_status:
        run(job, summarize=_overloaded, retry_count=2)

    assert state(db_session, job) == ("舊摘要", 0, "FAILED", ["舊章節"])
    update_status.assert_not_called()


def test_the_summary_row_is_updated_in_place_together_with_the_chapters(db_session, job):
    """Updating the existing row (not delete + insert) keeps a concurrent RequestRegeneration's row
    lock meaningful, and writing summary and chapters in one transaction means a poll can never see
    the new summary next to the old chapters."""
    before = db_session.scalar(select(Summary).where(Summary.job_id == job)).id

    run(job)

    db_session.expire_all()
    assert db_session.scalar(select(Summary).where(Summary.job_id == job)).id == before


def test_if_writing_the_chapters_fails_the_summary_is_not_replaced_either(db_session, job):
    with patch("app.repositories.summary_repository.replace_chapters", side_effect=RuntimeError("db hiccup")):
        run(job)

    assert state(db_session, job) == ("舊摘要", 0, "FAILED", ["舊章節"])

