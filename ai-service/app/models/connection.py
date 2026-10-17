import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.oauth_*（見 CONTEXT.md「已連結的帳號」）。


class ConnectionStatus(StrEnum):
    CONNECTED = "CONNECTED"
    INVALID = "INVALID"  # 換不到新的存取權杖：要重新連結


class OAuthConnection(Base):
    """一位使用者連結的一個外部服務。權杖用自有金鑰那套 AES-GCM 加密，綁定使用者、服務與權杖種類。"""

    __tablename__ = "oauth_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    service: Mapped[str] = mapped_column(String(16), primary_key=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    encrypted_access_token: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encrypted_refresh_token: Mapped[bytes | None] = mapped_column(LargeBinary)
    # 存取權杖到期的時間；對方沒說就是空的（當作不會過期）。
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 換權杖、撤銷時要帶的 client（Notion 是動態註冊的那一個）。
    client_id: Mapped[str] = mapped_column(String(200), nullable=False)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class OAuthPendingAuthorization(Base):
    """開始連結之後、對方回呼之前的一次授權：用 state 找回使用者。只能用一次，10 分鐘後作廢。"""

    __tablename__ = "oauth_pending_authorizations"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    service: Mapped[str] = mapped_column(String(16), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    client_id: Mapped[str] = mapped_column(String(200), nullable=False)
    # Gateway 放進瀏覽器 cookie 的值的 SHA-256：回呼時要帶同一個值，state 才算數（綁定開始連結的那個瀏覽器）。
    browser_binding_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # PKCE 的 code_verifier（Notion）；Google 不用。
    code_verifier: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class OAuthClient(Base):
    """向 Notion 動態註冊的 client：每個回呼網址註冊一次，之後重複使用。"""

    __tablename__ = "oauth_clients"

    service: Mapped[str] = mapped_column(String(16), primary_key=True)
    redirect_uri: Mapped[str] = mapped_column(Text, primary_key=True)
    client_id: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
