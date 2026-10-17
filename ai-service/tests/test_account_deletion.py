"""使用者刪除了帳號（`account.deleted`）：刪掉他的自有金鑰、預設模型、會後處理設定、還沒完成的連結授權；用量去識別化（user_id 設 NULL），
別人的不動（見 .scratch/account-deletion/issues/02）。已連結帳號的撤銷在 test_connections.py。"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.db import new_session
from app.models import (DefaultModel, LlmUsage, OAuthPendingAuthorization, PostMeetingSettings, ProviderKey,
                        WebSearchUsage)
from app.services import account_deletion, deletion_consumer

LEAVING = uuid.uuid4()
STAYING = uuid.uuid4()
JOB = uuid.uuid4()


def fill(user_id: uuid.UUID) -> None:
    with new_session() as session:
        session.add_all([
            ProviderKey(user_id=user_id, provider="groq", encrypted_key=b"x", last4="1234"),
            DefaultModel(user_id=user_id, provider="groq", model="m", supports_tools=True),
            PostMeetingSettings(user_id=user_id),
            OAuthPendingAuthorization(state=str(uuid.uuid4()), user_id=user_id, service="google", redirect_uri="r",
                                      client_id="c", browser_binding_hash="h", created_at=datetime.now(timezone.utc)),
            LlmUsage(user_id=user_id, job_id=JOB, feature="qa", provider="groq", model="m", key_source="own",
                     input_tokens=10, output_tokens=5, succeeded=True),
            WebSearchUsage(user_id=user_id, job_id=JOB, provider="tavily", feature="qa", succeeded=True),
        ])
        session.commit()


def count(model, **where) -> int:
    with new_session() as session:
        query = select(func.count()).select_from(model)
        for column, value in where.items():
            query = query.where(getattr(model, column) == value)
        return session.scalar(query)


@pytest.fixture
def two_users(db_session):
    fill(LEAVING)
    fill(STAYING)


def test_the_users_own_settings_are_deleted_and_other_users_are_untouched(two_users):
    account_deletion.delete_account_data(LEAVING)

    for model in (ProviderKey, DefaultModel, PostMeetingSettings, OAuthPendingAuthorization):
        assert count(model, user_id=LEAVING) == 0, model.__name__
        assert count(model, user_id=STAYING) == 1, model.__name__


def test_usage_is_kept_but_no_longer_linked_to_the_user(two_users):
    account_deletion.delete_account_data(LEAVING)

    for usage in (LlmUsage, WebSearchUsage):
        assert count(usage, user_id=LEAVING) == 0
        assert count(usage, user_id=STAYING) == 1
        assert count(usage) == 2  # 去識別化的那筆還在
    with new_session() as session:
        anonymous = session.scalar(select(LlmUsage).where(LlmUsage.user_id.is_(None)))
    assert (anonymous.job_id, anonymous.model, anonymous.input_tokens) == (JOB, "m", 10)


def test_handling_the_same_event_twice_is_fine(two_users):
    account_deletion.delete_account_data(LEAVING)
    account_deletion.delete_account_data(LEAVING)

    assert count(ProviderKey, user_id=LEAVING) == 0


def test_account_deleted_has_its_own_queue():
    queues = {s.exchange: s.queue for s in deletion_consumer.subscriptions()}

    assert queues["account.deleted"] == "account.deleted.ai"
