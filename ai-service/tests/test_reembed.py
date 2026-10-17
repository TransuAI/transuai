import json
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import grpc
import pytest
from sqlalchemy import select

from app.models import Embedding
from app.repositories.embedding_repository import save_embeddings
from app.services import reembed
from app.services.embedder import EmbeddingError
from app.services.job_status_client import job_status_client
from app.services.retry import RetryableMessageError


def vector(seed: float) -> list[float]:
    return [seed] * 1024


def segment(start: float, end: float, text: str):
    return SimpleNamespace(start_time=start, end_time=end, text=text)


@pytest.fixture
def job(db_session):
    """A job whose embeddings were computed by the pipeline from the unedited transcript."""
    job_id = uuid.uuid4()
    save_embeddings(db_session, job_id, [
        ("大家好", 0.0, 1.5, vector(0.1)),
        ("強風好雨", 1.5, 3.0, vector(0.2)),
        ("請不吝點讚訂閱", 3.0, 5.0, vector(0.3)),
    ])
    return job_id


def run(job_id, transcript_segments, embed=lambda texts: [vector(0.9) for _ in texts], retry_count=0):
    """Delivers transcript.edited for the job, with the given current transcript and embedder."""
    with (
        patch.object(reembed, "transcript_client") as transcript_client,
        patch.object(reembed, "embed_documents", side_effect=embed) as embed_documents,
    ):
        transcript_client.get_transcript.return_value = SimpleNamespace(segments=transcript_segments)
        reembed.process_transcript_edited(json.dumps({"jobId": str(job_id)}).encode(), retry_count=retry_count)
    return embed_documents


def stored(db_session, job_id):
    db_session.expire_all()
    rows = db_session.scalars(select(Embedding).where(Embedding.job_id == job_id).order_by(Embedding.start_time))
    return [(float(r.start_time), r.chunk_text, round(float(r.embedding[0]), 1)) for r in rows]


def test_only_segments_whose_text_changed_are_embedded_again(db_session, job):
    embed_documents = run(job, [segment(0.0, 1.5, "大家好"), segment(1.5, 3.0, "強風豪雨"), segment(3.0, 5.0, "請不吝點讚訂閱")])

    embed_documents.assert_called_once_with(["強風豪雨"])
    assert stored(db_session, job) == [(0.0, "大家好", 0.1), (1.5, "強風豪雨", 0.9), (3.0, "請不吝點讚訂閱", 0.3)]


def test_a_cleared_segment_loses_its_embedding_and_a_restored_one_gets_it_back(db_session, job):
    run(job, [segment(0.0, 1.5, "大家好"), segment(1.5, 3.0, "強風好雨"), segment(3.0, 5.0, "")])
    assert stored(db_session, job) == [(0.0, "大家好", 0.1), (1.5, "強風好雨", 0.2)]

    embed_documents = run(job, [segment(0.0, 1.5, "大家好"), segment(1.5, 3.0, "強風好雨"), segment(3.0, 5.0, "請不吝點讚訂閱")])

    embed_documents.assert_called_once_with(["請不吝點讚訂閱"])
    assert stored(db_session, job) == [(0.0, "大家好", 0.1), (1.5, "強風好雨", 0.2), (3.0, "請不吝點讚訂閱", 0.9)]


def test_nothing_is_embedded_when_nothing_changed(db_session, job):
    embed_documents = run(job, [segment(0.0, 1.5, "大家好"), segment(1.5, 3.0, "強風好雨"), segment(3.0, 5.0, "請不吝點讚訂閱")])

    embed_documents.assert_not_called()
    assert len(stored(db_session, job)) == 3


def _embedding_error(status: int) -> EmbeddingError:
    return EmbeddingError(f"失敗：HTTP {status}", transient=status >= 500)


def test_a_transient_embedding_failure_asks_for_a_retry(db_session, job):
    def overloaded(_texts):
        raise _embedding_error(503)

    with pytest.raises(RetryableMessageError):
        run(job, [segment(0.0, 1.5, "大家好改"), segment(1.5, 3.0, "強風好雨"), segment(3.0, 5.0, "請不吝點讚訂閱")], embed=overloaded)

    assert stored(db_session, job)[0] == (0.0, "大家好", 0.1)  # untouched until the retry succeeds


def test_once_the_retry_budget_is_spent_it_gives_up_with_a_log_instead_of_raising(db_session, job):
    def overloaded(_texts):
        raise _embedding_error(503)

    with (
        patch.object(reembed, "logger") as logger,
        patch.object(job_status_client, "update_status") as update_status,
    ):
        run(job, [segment(0.0, 1.5, "大家好改"), segment(1.5, 3.0, "強風好雨"), segment(3.0, 5.0, "請不吝點讚訂閱")],
            embed=overloaded, retry_count=2)

    logger.exception.assert_called_once()
    update_status.assert_not_called()  # an edit is not the Job's pipeline: no FAILED status


def test_a_permanent_failure_fetching_the_transcript_is_not_retried(db_session, job):
    class NotFound(grpc.RpcError):
        def code(self):
            return grpc.StatusCode.NOT_FOUND

    with (
        patch.object(reembed, "transcript_client") as transcript_client,
        patch.object(reembed, "logger") as logger,
    ):
        transcript_client.get_transcript.side_effect = NotFound()
        reembed.process_transcript_edited(json.dumps({"jobId": str(job)}).encode(), retry_count=0)

    logger.exception.assert_called_once()
