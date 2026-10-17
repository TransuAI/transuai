"""每月平台模型用量上限的 ai-service 這一側。花錢的要求在 gateway 送出前就檢查過（gateway UsageLimitGuard）；這裡給跑很久的背景工作
（翻譯一批一批翻）與不經過 gateway 的（編輯後自動重翻）自己檢查。算法跟 gateway 一樣：台北時間的這個月、平台金鑰的輸入＋輸出 token，
上限是同一個設定（USAGE_LIMIT_PLATFORM_TOKENS，兩邊要一致）。用使用者自有金鑰的模型不受限。"""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.db import new_session
from app.repositories.llm_usage_repository import sum_user_llm_usage
from app.services.llm_client import PLATFORM, ChatModel
from app.services.usage_meter import KeySource

_ZONE = ZoneInfo("Asia/Taipei")

LIMIT_REASON = "這個月的平台模型已經到用量上限，下個月 1 日恢復；可以改用自有金鑰的模型"


def platform_tokens_left(user_id: uuid.UUID | None, model: ChatModel) -> bool:
    if model.provider != PLATFORM or user_id is None:
        return True
    start = datetime.now(_ZONE).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=32)).replace(day=1)
    with new_session() as session:
        sums = sum_user_llm_usage(session, user_id, start, end)
    used = sum(s.input_tokens + s.output_tokens for s in sums if s.key_source == KeySource.PLATFORM)
    return used < settings.usage_limit_platform_tokens

