"""啟動時讓資料庫裡的向量跟設定的 embedding 模型一致（見 docs/adr/0015）：

- **換了模型**（EMBEDDING_MODEL 跟 embedding_state 記的不一樣）：舊模型算的向量跟新模型算的問題比不出意義，把每個 Job 的逐字稿片段
  與每個決策重算一遍，算完才記下新模型。中途失敗就不記，下次啟動整批重來。
- **沒換模型**：補算缺的——沒設定 embedding 伺服器那段時間處理完的 Job（有摘要、沒有向量）、沒有向量的決策。

在背景 thread 跑，不擋 gRPC 與 MQ。重算期間還沒輪到的 Job，問答找段落會不準，摘要與章節照常。多個副本同時啟動時只有一個做
（advisory lock），其他的直接略過。
"""

import logging
import time
import uuid
from datetime import datetime, timezone

import grpc
from sqlalchemy import select, text, update

from app.core.config import settings
from app.db import engine, new_session
from app.models import Decision, Embedding, EmbeddingState, Summary
from app.repositories.embedding_repository import save_embeddings
from app.services import embedder
from app.services.decisions import embedding_text
from app.services.embedder import embed_documents
from app.services.retry import is_retryable_grpc_error
from app.services.transcript_client import transcript_client

logger = logging.getLogger(__name__)

# 跟 app/db/session.py 的 migration lock 不同的一把：同時只有一個副本在重算。
_LOCK_KEY = 820261017
# transcription-service 可能比 ai-service 晚起來：讀逐字稿暫時失敗時等一下再試。
_TRANSCRIPT_ATTEMPTS = 5
_TRANSCRIPT_RETRY_SECONDS = 10.0


def sync_embeddings() -> None:
    """main.serve 在背景 thread 呼叫。任何失敗只記 log——向量只影響找段落，不值得讓服務起不來。"""
    if not embedder.is_configured():
        return
    try:
        with engine.connect() as lock:
            if not lock.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _LOCK_KEY}).scalar():
                logger.info("another replica is bringing the embeddings up to date")
                return
            try:
                _sync()
            finally:
                lock.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _LOCK_KEY})
    except Exception:
        logger.exception("could not bring the embeddings up to date with %s", settings.embedding_model)


def _sync() -> None:
    current = settings.embedding_model
    with new_session() as session:
        stored = session.scalar(select(EmbeddingState.model).where(EmbeddingState.id == 1))
    if stored is not None and stored != current:
        logger.info("embedding model changed from %s to %s: re-embedding every job and decision", stored, current)
        complete = _embed_jobs(_jobs_with_content()) & _embed_decisions(only_missing=False)
    else:
        complete = _embed_jobs(_jobs_without_vectors()) & _embed_decisions(only_missing=True)
    if complete and stored != current:
        with new_session() as session:
            session.merge(EmbeddingState(id=1, model=current, updated_at=datetime.now(timezone.utc)))
            session.commit()
        logger.info("embeddings are now made by %s", current)


def _jobs_with_content() -> list[uuid.UUID]:
    """有摘要或有向量的 Job：處理完的都有摘要。"""
    with new_session() as session:
        summarized = set(session.scalars(select(Summary.job_id)))
        embedded = set(session.scalars(select(Embedding.job_id).distinct()))
    return sorted(summarized | embedded)


def _jobs_without_vectors() -> list[uuid.UUID]:
    with new_session() as session:
        embedded = select(Embedding.job_id).distinct()
        return list(session.scalars(select(Summary.job_id).where(Summary.job_id.not_in(embedded))))


def _embed_jobs(job_ids: list[uuid.UUID]) -> bool:
    """每個 Job 讀最新的逐字稿、整份重算後換掉。回傳是不是每個都做完了（找不到逐字稿的 Job 算做完：已經沒東西可算）。"""
    complete = True
    for n, job_id in enumerate(job_ids, start=1):
        try:
            transcript = _transcript(job_id)
            segments = [segment for segment in transcript.segments if segment.text] if transcript else []
            if not segments:
                continue
            vectors = embed_documents([segment.text for segment in segments])
            with new_session() as session:
                save_embeddings(session, job_id, [
                    (segment.text, segment.start_time, segment.end_time, vector)
                    for segment, vector in zip(segments, vectors)
                ])
            logger.info("re-embedded job %s (%d/%d, %d segments)", job_id, n, len(job_ids), len(segments))
        except Exception:
            complete = False
            logger.exception("could not re-embed job %s", job_id)
    return complete


def _transcript(job_id: uuid.UUID):
    """最新的逐字稿；Job 已經不在了（NOT_FOUND）回 None。暫時連不上就等一下再試。"""
    for attempt in range(1, _TRANSCRIPT_ATTEMPTS + 1):
        try:
            return transcript_client.get_transcript(str(job_id))
        except grpc.RpcError as exc:
            if exc.code() == grpc.StatusCode.NOT_FOUND:
                return None
            if attempt == _TRANSCRIPT_ATTEMPTS or not is_retryable_grpc_error(exc):
                raise
            time.sleep(_TRANSCRIPT_RETRY_SECONDS)
    return None


def _embed_decisions(*, only_missing: bool) -> bool:
    with new_session() as session:
        query = select(Decision.id, Decision.statement, Decision.rationale)
        if only_missing:
            query = query.where(Decision.embedding.is_(None))
        rows = list(session.execute(query))
    if not rows:
        return True
    try:
        vectors = embed_documents([embedding_text(statement, rationale) for _, statement, rationale in rows])
        with new_session() as session:
            for (decision_id, _, _), vector in zip(rows, vectors):
                session.execute(update(Decision).where(Decision.id == decision_id).values(embedding=vector))
            session.commit()
        logger.info("re-embedded %d decisions", len(rows))
        return True
    except Exception:
        logger.exception("could not re-embed %d decisions", len(rows))
        return False
