import json
import logging
import uuid

from app.db import new_session
from app.repositories.embedding_repository import apply_embedding_changes, find_by_job_id
from app.services.embedder import embed_documents
from app.services.retry import RetryableMessageError, has_retry_budget, is_retryable_error
from app.services.transcript_client import transcript_client
from app.services.segment_times import time_key

logger = logging.getLogger(__name__)


def process_transcript_edited(body: bytes, retry_count: int = 0) -> None:
    """處理一則 transcript.edited { jobId }（見根目錄 docs/adr/0003）：回頭讀最新的逐字稿，以片段的
    起訖時間對應這個 job 現有的 embedding，只動有變的——文字變了就重算、被清空就刪掉、從清空還原
    就重新算一筆；沒有任何變化就連 embedder 都不呼叫。

    暫時性失敗（HF / gRPC）且還有重試預算時 raise RetryableMessageError，交給 consumer 送進這個
    queue 自己的 retry queue；其他失敗只記 log——這不是 Job 的 pipeline，不回寫 Job 狀態、不發
    job.failed，問答的檢索資料就先維持舊的，等下一次編輯再更新。
    """
    job_id = json.loads(body)["jobId"]
    try:
        transcript = transcript_client.get_transcript(job_id)
        session = new_session()
        try:
            existing = {time_key(row.start_time, row.end_time): row for row in find_by_job_id(session, uuid.UUID(job_id))}
            to_embed, deletions = [], []
            for segment in transcript.segments:
                key = time_key(segment.start_time, segment.end_time)
                row = existing.get(key)
                if segment.text == "":
                    if row is not None:
                        deletions.append(key)
                elif row is None or row.chunk_text != segment.text:
                    to_embed.append((segment.text, *key))
            if not to_embed and not deletions:
                logger.info("transcript.edited for job %s: embeddings already up to date", job_id)
                return
            vectors = embed_documents([text for text, _, _ in to_embed]) if to_embed else []
            apply_embedding_changes(
                session,
                uuid.UUID(job_id),
                upserts=[(text, start, end, vector) for (text, start, end), vector in zip(to_embed, vectors)],
                deletions=deletions,
            )
            logger.info("transcript.edited for job %s: re-embedded %d, removed %d", job_id, len(to_embed), len(deletions))
        finally:
            session.close()
    except Exception as exc:
        if is_retryable_error(exc) and has_retry_budget(retry_count):
            raise RetryableMessageError(f"job {job_id}: transient failure, retry_count={retry_count}") from exc
        logger.exception("transcript.edited for job %s failed; its Q&A embeddings stay as they were", job_id)
