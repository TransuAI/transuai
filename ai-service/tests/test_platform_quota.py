"""每月平台模型上限在 ai-service 這一側（不經過 gateway 的背景工作自己檢查）：跟 gateway 一樣，台北時間這個月、平台金鑰的輸入＋輸出
token。真的 Postgres。"""

import uuid
from datetime import datetime, timedelta, timezone

from app.db import new_session
from app.models import LlmUsage
from app.services import platform_quota
from app.services.llm_client import ChatModel

USER = uuid.UUID("00000000-0000-0000-0000-0000000000a7")
PLATFORM_MODEL = ChatModel(provider="platform", model="qwen3:14b", api_key="", base_url="")
OWN_MODEL = ChatModel(provider="openai", model="gpt-5", api_key="sk", base_url="")


def used(tokens, key_source="platform", when=None, user=USER):
    with new_session() as session:
        row = LlmUsage(user_id=user, job_id=uuid.uuid4(), feature="translation", provider="platform", model="m",
                       key_source=key_source, input_tokens=tokens, output_tokens=0, succeeded=True)
        if when is not None:
            row.created_at = when
        session.add(row)
        session.commit()


def test_platform_tokens_are_left_until_this_months_use_reaches_the_limit(db_session, monkeypatch):
    monkeypatch.setattr(platform_quota.settings, "usage_limit_platform_tokens", 1000)
    used(600)
    used(5000, key_source="own_key")  # the user's own key doesn't count
    used(5000, when=datetime.now(timezone.utc) - timedelta(days=40))  # nor last month
    used(5000, user=uuid.uuid4())  # nor someone else
    assert platform_quota.platform_tokens_left(USER, PLATFORM_MODEL)

    used(400)

    assert not platform_quota.platform_tokens_left(USER, PLATFORM_MODEL)


def test_the_users_own_key_is_never_limited(db_session, monkeypatch):
    monkeypatch.setattr(platform_quota.settings, "usage_limit_platform_tokens", 0)

    assert platform_quota.platform_tokens_left(USER, OWN_MODEL)
