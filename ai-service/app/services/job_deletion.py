"""Job 在 upload-service 刪掉之後（`job.deleted`），清掉這個服務手上這個 Job 的資料：摘要、章節、embedding、問答、測驗（題目、作答跟著
cascade）、講者名字建議、會後處理（行動提案跟著 cascade）。用量（`llm_usage`、`web_search_usage`）不刪：月用量不能因為刪 Job 變少
（刪帳號時才去識別化，見 .scratch/account-deletion）。

刪除時可能還有寫入在跑（AI pipeline、重算 embedding、重新產生摘要、出題、講者名字建議、會後處理、問答存紀錄），晚一步寫進來就成了
孤兒資料。所以先記下「這個 Job 已刪」（`deleted_jobs`，commit）再刪資料；寫入那一邊不用每個地方自己檢查——`guard_writes` 在 session
上掛一個 hook：commit 寫到哪些 Job 的資料，commit 之後就查這些 Job 有沒有被刪，有就把它的資料刪掉。兩種先後都蓋得到：寫入先 commit →
後面的刪除會刪到它；寫入後 commit → 它查的時候標記已經在。標記保留一天，夠蓋過任何還在跑的寫入。"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, event, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.db import new_session
from app.models import (Chapter, Decision, DecisionExtraction, DeletedJob, Embedding, GeneratedOutput, PostMeetingRun,
                        QaHistory, Quiz, SpeakerInsightRun, SpeakerSuggestion, Summary, Translation)

logger = logging.getLogger(__name__)

_KEEP_MARKERS = timedelta(days=1)
# 直接帶 job_id 的表；題目、作答、行動提案、講者數據的項目、片段的譯文的外鍵是 ON DELETE CASCADE，跟著它們的上一層刪掉。
# 別的 Job 的決策「取代」了這個 Job 的決策時，取代的連結是 ON DELETE SET NULL，跟著消失。
JOB_SCOPED = (Summary, Chapter, Embedding, QaHistory, Quiz, SpeakerSuggestion, PostMeetingRun, SpeakerInsightRun,
              GeneratedOutput, Translation, Decision, DecisionExtraction)
_WRITTEN_JOBS = "written_job_ids"


def delete_job_data(job_id: uuid.UUID) -> None:
    """處理 `job.deleted`：可以重複呼叫（刪不存在的東西不算錯）。"""
    now = datetime.now(timezone.utc)
    with new_session() as session:
        session.execute(insert(DeletedJob).values(job_id=job_id, deleted_at=now).on_conflict_do_nothing())
        session.execute(delete(DeletedJob).where(DeletedJob.deleted_at < now - _KEEP_MARKERS))
        session.commit()
    _delete_rows(job_id)
    logger.info("deleted AI data of deleted job %s", job_id)


def discard_if_deleted(job_id: uuid.UUID) -> bool:
    """這個 Job 已經刪掉就把它的資料刪掉，回傳 True。寫入 commit 之後由 `guard_writes` 的 hook 呼叫。"""
    with new_session() as session:
        deleted = session.scalar(select(DeletedJob.job_id).where(DeletedJob.job_id == job_id)) is not None
    if deleted:
        _delete_rows(job_id)
        logger.info("job %s was deleted while its data was being written, discarded the write", job_id)
    return deleted


def guard_writes(session_factory: sessionmaker) -> None:
    """服務啟動時呼叫一次：這個 factory 開的 session，commit 寫到（新增或修改）哪些 Job 的資料，commit 之後就 `discard_if_deleted`。
    查詢失敗只記 log：寫入本身已經成功，Job 沒被刪的話什麼事都沒有。"""
    if event.contains(session_factory, "after_flush", _remember_written_jobs):
        return
    event.listen(session_factory, "after_flush", _remember_written_jobs)
    event.listen(session_factory, "after_commit", _discard_written_jobs_if_deleted)
    event.listen(session_factory, "after_soft_rollback", _forget_written_jobs)


def _remember_written_jobs(session: Session, _flush_context) -> None:
    written = session.info.setdefault(_WRITTEN_JOBS, set())
    for instance in (*session.new, *session.dirty):
        if isinstance(instance, JOB_SCOPED):
            written.add(instance.job_id)


def _discard_written_jobs_if_deleted(session: Session) -> None:
    for job_id in session.info.pop(_WRITTEN_JOBS, set()):
        try:
            discard_if_deleted(job_id)
        except Exception:
            logger.exception("could not check whether job %s was deleted after writing its data", job_id)


def _forget_written_jobs(session: Session, _previous_transaction) -> None:
    session.info.pop(_WRITTEN_JOBS, None)


def _delete_rows(job_id: uuid.UUID) -> None:
    with new_session() as session:
        for model in JOB_SCOPED:
            session.execute(delete(model).where(model.job_id == job_id))
        session.commit()
