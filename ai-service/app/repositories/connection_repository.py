import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import OAuthClient, OAuthConnection, OAuthPendingAuthorization


def find_connection(session: Session, user_id: uuid.UUID, service: str, *, lock: bool = False) -> OAuthConnection | None:
    query = select(OAuthConnection).where(OAuthConnection.user_id == user_id, OAuthConnection.service == service)
    return session.scalar(query.with_for_update() if lock else query)


def replace_connection(session: Session, connection: OAuthConnection) -> None:
    """連結（或重新連結）：同一位使用者同一個服務只留最新的一份。"""
    session.execute(delete(OAuthConnection).where(
        OAuthConnection.user_id == connection.user_id, OAuthConnection.service == connection.service))
    session.add(connection)
    session.commit()


def delete_connection(session: Session, user_id: uuid.UUID, service: str) -> None:
    session.execute(delete(OAuthConnection).where(OAuthConnection.user_id == user_id, OAuthConnection.service == service))
    session.commit()


def save_pending(session: Session, pending: OAuthPendingAuthorization, *, drop_created_before: datetime) -> None:
    """記下一次授權，順便清掉過期、沒人回來完成的。"""
    session.execute(delete(OAuthPendingAuthorization).where(OAuthPendingAuthorization.created_at <= drop_created_before))
    session.add(pending)
    session.commit()


def take_pending(session: Session, state: str, service: str, *, created_after: datetime) -> OAuthPendingAuthorization | None:
    """取出並刪掉這次授權（state 只能用一次）；過期的也順便刪掉，但不回傳。"""
    pending = session.scalar(select(OAuthPendingAuthorization).where(
        OAuthPendingAuthorization.state == state, OAuthPendingAuthorization.service == service).with_for_update())
    if pending is None:
        return None
    session.delete(pending)
    session.commit()
    return pending if pending.created_at > created_after else None


def find_client(session: Session, service: str, redirect_uri: str) -> OAuthClient | None:
    return session.get(OAuthClient, (service, redirect_uri))


def save_client(session: Session, client: OAuthClient) -> None:
    session.merge(client)
    session.commit()
