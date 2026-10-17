import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 自有金鑰（見 CONTEXT.md「自有金鑰」）：每位使用者每個廠商最多一把，加密存放（見 app/services/key_encryption.py）。


class ProviderKey(Base):
    __tablename__ = "provider_keys"
    __table_args__ = (UniqueConstraint("user_id", "provider"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    encrypted_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # 末四碼，給使用者辨認是哪一把；金鑰本身永遠不回傳。
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    # 最後一次存入（或替換）的時間。
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
