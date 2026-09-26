import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import ProviderKey


def upsert_provider_key(session: Session, user_id: uuid.UUID, provider: str, encrypted_key: bytes, last4: str) -> ProviderKey:
    """存入或替換（同一位使用者、同一個廠商只有一把）。"""
    now = datetime.now(timezone.utc)
    session.execute(
        insert(ProviderKey)
        .values(id=uuid.uuid4(), user_id=user_id, provider=provider, encrypted_key=encrypted_key, last4=last4,
                created_at=now)
        .on_conflict_do_update(
            index_elements=["user_id", "provider"],
            set_={"encrypted_key": encrypted_key, "last4": last4, "created_at": now},
        )
    )
    session.commit()
    return session.scalars(
        select(ProviderKey).where(ProviderKey.user_id == user_id, ProviderKey.provider == provider)).one()


def delete_provider_key(session: Session, user_id: uuid.UUID, provider: str) -> bool:
    """刪除（不 commit，由呼叫端跟其他變更放在同一個 transaction）。"""
    result = session.execute(
        delete(ProviderKey).where(ProviderKey.user_id == user_id, ProviderKey.provider == provider))
    return result.rowcount > 0  # type: ignore[attr-defined]


def find_provider_key(session: Session, user_id: uuid.UUID, provider: str) -> ProviderKey | None:
    return session.scalars(
        select(ProviderKey).where(ProviderKey.user_id == user_id, ProviderKey.provider == provider)).one_or_none()


def list_provider_keys(session: Session, user_id: uuid.UUID) -> list[ProviderKey]:
    return list(session.scalars(
        select(ProviderKey).where(ProviderKey.user_id == user_id).order_by(ProviderKey.provider)))
