import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 預設模型（見 CONTEXT.md）：每位使用者一筆；沒有這一筆就是平台模型。


class DefaultModel(Base):
    __tablename__ = "default_models"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # 某個有自有金鑰的廠商
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    # 選的時候確認過能不能呼叫工具（會後處理需要）；OpenRouter 的模型只有選的當下查得到。
    supports_tools: Mapped[bool] = mapped_column(Boolean, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
