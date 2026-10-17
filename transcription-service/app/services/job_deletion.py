"""Job 在 upload-service 刪掉之後（`job.deleted`），清掉這個服務手上這個 Job 的逐字稿（片段、講者跟著 cascade）與快取。
轉錄用量不刪：月用量不能因為刪 Job 變少（刪帳號時才去識別化，見 account-deletion spec）。

刪除時可能還有寫入在跑（轉錄存檔、編輯），晚一步寫進來就成了孤兒資料。所以先記下「這個 Job 已刪」（`deleted_jobs`，commit）再刪資料；
每個寫入在 commit 之後呼叫 `discard_if_deleted`。兩種先後都蓋得到：寫入先 commit → 後面的刪除會刪到它；寫入後 commit → 它查的時候
標記已經在。只在寫入前查會有空窗（查完、標記才寫、刪除跑完、寫入才 commit）。標記保留一天，夠蓋過任何還在跑的寫入。"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.db import new_session
from app.models.transcript import DeletedJob, Transcript
from app.services import transcript_cache

logger = logging.getLogger(__name__)

_KEEP_MARKERS = timedelta(days=1)


def delete_job_data(job_id: uuid.UUID) -> None:
    """處理 `job.deleted`：可以重複呼叫（刪不存在的東西不算錯）。"""
    now = datetime.now(timezone.utc)
    with new_session() as session:
        session.execute(insert(DeletedJob).values(job_id=job_id, deleted_at=now).on_conflict_do_nothing())
        session.execute(delete(DeletedJob).where(DeletedJob.deleted_at < now - _KEEP_MARKERS))
        session.commit()
    _delete_transcript(job_id)
    logger.info("deleted transcript data of deleted job %s", job_id)


def discard_if_deleted(job_id: uuid.UUID) -> bool:
    """寫入 commit 之後呼叫：這個 Job 已經刪掉就把剛寫的刪掉，回傳 True（呼叫端不要再往下做）。"""
    with new_session() as session:
        deleted = session.scalar(select(DeletedJob.job_id).where(DeletedJob.job_id == job_id)) is not None
    if deleted:
        _delete_transcript(job_id)
        logger.info("job %s was deleted while writing its transcript, discarded the write", job_id)
    return deleted


def _delete_transcript(job_id: uuid.UUID) -> None:
    with new_session() as session:
        # 片段、講者的外鍵是 ON DELETE CASCADE。
        session.execute(delete(Transcript).where(Transcript.job_id == job_id))
        session.commit()
    transcript_cache.forget(job_id)
