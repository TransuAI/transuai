"""啟動時讓向量跟設定的 embedding 模型一致（services/embedding_migration）：換了模型就全部重算、沒換就補算缺的。
資料庫是真的（testcontainers），逐字稿（gRPC）與 embedding 伺服器是假的。"""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import grpc
import pytest
from sqlalchemy import select

from app.models import Decision, Embedding, EmbeddingState
from app.repositories.embedding_repository import save_embeddings
from app.repositories.summary_repository import save_summary
from app.services import embedding_migration

NEW_MODEL = "Qwen/Qwen3-Embedding-0.6B"  # what the tests configure (conftest)


def vector(seed: float) -> list[float]:
    return [seed] + [0.0] * 1023


class _NotFound(grpc.RpcError):
    def code(self):
        return grpc.StatusCode.NOT_FOUND


@pytest.fixture
def transcripts():
    """Each job's current transcript, as transcription-service would return it; a job missing here is gone."""
    by_job: dict[str, list] = {}

    def get_transcript(job_id):
        if job_id not in by_job:
            raise _NotFound()
        return SimpleNamespace(segments=[SimpleNamespace(start_time=s, end_time=e, text=t) for s, e, t in by_job[job_id]])

    with patch.object(embedding_migration, "transcript_client") as client:
        client.get_transcript.side_effect = get_transcript
        yield by_job


def embedded_by_new_model(texts):
    return [vector(0.9) for _ in texts]


def state(db_session):
    db_session.expire_all()
    return db_session.scalar(select(EmbeddingState.model))


def stored(db_session, job_id):
    db_session.expire_all()
    rows = db_session.scalars(select(Embedding).where(Embedding.job_id == job_id).order_by(Embedding.start_time))
    return [(r.chunk_text, round(float(r.embedding[0]), 1)) for r in rows]


def a_job(db_session, transcripts, *, vectors: bool):
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "摘要", source_revision=0, model=("platform", "m"))
    transcripts[str(job_id)] = [(0.0, 2.0, "大家好"), (2.0, 4.0, ""), (4.0, 6.0, "今天談預算")]
    if vectors:
        save_embeddings(db_session, job_id, [("大家好", 0.0, 2.0, vector(0.1)), ("今天談預算", 4.0, 6.0, vector(0.1))])
    return job_id


def a_decision(db_session, *, embedded: bool):
    decision = Decision(job_id=uuid.uuid4(), user_id=uuid.uuid4(), statement="資料庫用 PostgreSQL", rationale="要 pgvector",
                        embedding=vector(0.1) if embedded else None)
    db_session.add(decision)
    db_session.commit()
    return decision.id


def decision_vector(db_session, decision_id):
    db_session.expire_all()
    found = db_session.scalar(select(Decision.embedding).where(Decision.id == decision_id))
    return None if found is None else round(float(found[0]), 1)


def remember(db_session, model):
    db_session.merge(EmbeddingState(id=1, model=model))
    db_session.commit()


def sync(embed=embedded_by_new_model):
    with patch.object(embedding_migration, "embed_documents", side_effect=embed) as embed_documents:
        embedding_migration.sync_embeddings()
    return embed_documents


def test_a_new_model_re_embeds_every_job_and_decision_then_remembers_it(db_session, transcripts):
    remember(db_session, "BAAI/bge-m3")
    job = a_job(db_session, transcripts, vectors=True)
    decision = a_decision(db_session, embedded=True)

    sync()

    assert stored(db_session, job) == [("大家好", 0.9), ("今天談預算", 0.9)]  # the current transcript, cleared segment left out
    assert decision_vector(db_session, decision) == 0.9
    assert state(db_session) == NEW_MODEL


def test_the_same_model_only_fills_in_what_is_missing(db_session, transcripts):
    remember(db_session, NEW_MODEL)
    done = a_job(db_session, transcripts, vectors=True)
    processed_without_an_embedding_server = a_job(db_session, transcripts, vectors=False)
    embedded = a_decision(db_session, embedded=True)
    missing = a_decision(db_session, embedded=False)

    embed_documents = sync()

    assert stored(db_session, done) == [("大家好", 0.1), ("今天談預算", 0.1)]  # untouched
    assert stored(db_session, processed_without_an_embedding_server) == [("大家好", 0.9), ("今天談預算", 0.9)]
    assert (decision_vector(db_session, embedded), decision_vector(db_session, missing)) == (0.1, 0.9)
    assert embed_documents.call_count == 2  # the one job, the one decision


def test_a_fresh_install_just_remembers_the_model(db_session, transcripts):
    embed_documents = sync()

    embed_documents.assert_not_called()
    assert state(db_session) == NEW_MODEL


def test_a_job_that_is_gone_is_skipped(db_session, transcripts):
    remember(db_session, "BAAI/bge-m3")
    job = a_job(db_session, transcripts, vectors=True)
    del transcripts[str(job)]

    sync()

    assert state(db_session) == NEW_MODEL


def test_a_failure_leaves_the_old_model_on_record_so_the_next_start_tries_again(db_session, transcripts):
    remember(db_session, "BAAI/bge-m3")
    a_job(db_session, transcripts, vectors=True)

    def down(_texts):
        raise RuntimeError("vLLM is down")

    sync(embed=down)

    assert state(db_session) == "BAAI/bge-m3"


def test_without_an_embedding_server_nothing_happens(db_session, transcripts):
    remember(db_session, "BAAI/bge-m3")
    a_job(db_session, transcripts, vectors=True)

    with patch.object(embedding_migration.settings, "embedding_base_url", ""):
        embed_documents = sync()

    embed_documents.assert_not_called()
    assert state(db_session) == "BAAI/bge-m3"
