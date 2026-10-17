"""使用者刪除了帳號（auth-service 的 `account.deleted`）：這個服務手上跟他本人有關的只有轉錄用量——**去識別化**（`user_id` 設成 NULL），
其他欄位留著，平台每個月的總用量還對得上帳單（他的 Job 都刪了，job_id 對不到任何人）。他的逐字稿由 upload-service 刪 Job 時發的
`job.deleted` 清（見 job_deletion）。可以重複處理。"""

import logging
import uuid

from sqlalchemy import update

from app.db import new_session
from app.models.transcript import TranscriptionUsage

logger = logging.getLogger(__name__)


def delete_account_data(user_id: uuid.UUID) -> None:
    with new_session() as session:
        session.execute(update(TranscriptionUsage).where(TranscriptionUsage.user_id == user_id).values(user_id=None))
        session.commit()
    logger.info("de-identified the transcription usage of deleted user %s", user_id)
