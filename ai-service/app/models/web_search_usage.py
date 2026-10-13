import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 網路搜尋的用量（見 CONTEXT.md「用量」「網路搜尋」）：問答每查一次網路、事實查核每查一條主張各一筆，成功或失敗都記，記在使用者與 Job 名下。
# 量是次數，不是 token，所以不放在 llm_usage。用量上限只算成功的。


class WebSearchFeature(StrEnum):
    """為了什麼查網路。每月上限兩者共用。"""

    QA = "qa"  # 問答的查網路
    FACT_CHECK = "fact_check"  # 事實查核：查核一條主張


class WebSearchUsage(Base):
    __tablename__ = "web_search_usage"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)  # 搜尋服務，例如 tavily
    feature: Mapped[str] = mapped_column(String(16), nullable=False)  # WebSearchFeature
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
