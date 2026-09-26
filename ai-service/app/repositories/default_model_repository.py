import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import DefaultModel


def find_default_model(session: Session, user_id: uuid.UUID) -> DefaultModel | None:
    return session.get(DefaultModel, user_id)


def upsert_default_model(session: Session, user_id: uuid.UUID, provider: str, model: str, supports_tools: bool) -> None:
    now = datetime.now(timezone.utc)
    session.execute(
        insert(DefaultModel)
        .values(user_id=user_id, provider=provider, model=model, supports_tools=supports_tools, updated_at=now)
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"provider": provider, "model": model, "supports_tools": supports_tools, "updated_at": now},
        )
    )


def delete_default_model(session: Session, user_id: uuid.UUID, *, provider: str | None = None) -> bool:
    """回到平台模型（沒有這一筆就是平台模型）。給了 provider 時，只在預設模型用的是這個廠商時才刪。"""
    statement = delete(DefaultModel).where(DefaultModel.user_id == user_id)
    if provider is not None:
        statement = statement.where(DefaultModel.provider == provider)
    return session.execute(statement).rowcount > 0  # type: ignore[attr-defined]
