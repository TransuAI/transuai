import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 多格式輸出（見 CONTEXT.md「多格式輸出」）：依一個 Job 產生的新文件（Podcast 介紹、部落格文章…），一份一筆；同一個 Job 可以有很多份。


class OutputStatus(StrEnum):
    GENERATING = "GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class GeneratedOutput(Base):
    __tablename__ = "generated_outputs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # 要求產生的使用者：用他的預設模型、用量記在他名下。
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    format: Mapped[str] = mapped_column(String(32), nullable=False)
    # 產生時的選項：社群貼文的平台、使用者的一句要求。
    options: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    # 依據的逐字稿 revision 與產生的模型；完成之前是空的。
    source_revision: Mapped[int | None] = mapped_column(Integer)
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 使用者改過內容的時間；沒改過是空的。
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
