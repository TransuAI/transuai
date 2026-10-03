"""使用者刪除了帳號（auth-service 的 `account.deleted`）：清掉這個服務手上跟他本人有關的資料。

- 已連結的帳號（Google、Notion）：先向對方撤銷授權再刪權杖（沿用中斷連結的 `connections.disconnect`；撤銷失敗只記 log、權杖照樣刪）。
- 自有金鑰、預設模型、會後處理設定、還沒完成的連結授權：刪除。
- 用量（`llm_usage`、`web_search_usage`）：**去識別化**——`user_id` 設成 NULL，其他欄位留著（平台每個月的總用量與成本還對得上帳單；他的 Job
  都刪了，job_id 對不到任何人）。
- 他的 Job 的資料（摘要、問答、測驗……）不在這裡：upload-service 刪掉每個 Job 時發 `job.deleted`，由 `job_deletion` 清。

可以重複處理（刪不存在的東西、把已經是 NULL 的再設一次都沒事）。"""

import logging
import uuid

from sqlalchemy import delete, select, update

from app.db import new_session
from app.models import (DefaultModel, LlmUsage, OAuthConnection, OAuthPendingAuthorization, PostMeetingSettings,
                        ProviderKey, WebSearchUsage)
from app.services import connections

logger = logging.getLogger(__name__)


def delete_account_data(user_id: uuid.UUID) -> None:
    _unlink_everything(user_id)
    with new_session() as session:
        for model in (ProviderKey, DefaultModel, PostMeetingSettings, OAuthPendingAuthorization, OAuthConnection):
            session.execute(delete(model).where(model.user_id == user_id))
        for usage in (LlmUsage, WebSearchUsage):
            session.execute(update(usage).where(usage.user_id == user_id).values(user_id=None))
        session.commit()
    logger.info("deleted the account data of user %s and de-identified their usage", user_id)


def _unlink_everything(user_id: uuid.UUID) -> None:
    with new_session() as session:
        services = session.scalars(select(OAuthConnection.service).where(OAuthConnection.user_id == user_id)).all()
    for service in services:
        try:
            revoked = connections.disconnect(user_id, service)
        except connections.UnknownService:
            # 這個服務已經不支援了：撤銷不了，權杖在上面跟其他資料一起刪。
            logger.warning("user %s was linked to %s, which is no longer supported; deleting its tokens", user_id, service)
            continue
        if not revoked:
            logger.warning("could not revoke user %s's %s grant while deleting the account; deleted the tokens anyway",
                           user_id, service)
