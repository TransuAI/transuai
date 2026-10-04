import uuid
from datetime import datetime, timezone
from enum import StrEnum

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 決策紀錄（見 CONTEXT.md「決策」、.scratch/decision-log、services/decisions.py）：每個 Job 一份抽取紀錄（狀態、模型、依據的 revision），
# 決策一筆一列。重新抽時只換掉 AI 抽的、使用者沒改過的；使用者改過（edited）或自己新增的（source = user）保留。


class DecisionExtractionStatus(StrEnum):
    GENERATING = "GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class DecisionSource(StrEnum):
    AI = "ai"
    USER = "user"


class DecisionExtraction(Base):
    __tablename__ = "decision_extractions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    # 最近一次要求抽取的使用者（轉錄後自動抽的是 Job 擁有者）：用他的預設模型、用量記在他名下。
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # 上一次完成的依據 revision 與模型；還沒完成過是空的。
    source_revision: Mapped[int | None] = mapped_column(Integer)
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # Job 的擁有者：跨 Job 的時間軸、搜尋、問決策都只查這位使用者的。
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    alternatives: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    proposed_by: Mapped[str | None] = mapped_column(String(32))  # 講者標籤
    tentative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    start_time: Mapped[float | None] = mapped_column(Numeric(10, 2))
    evidence_text: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(8), nullable=False, default=DecisionSource.AI)
    edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 這個決策取代了較早的哪一個（見 CONTEXT.md「取代」）；那個被刪掉（例如刪 Job）就變回空的。
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("decisions.id", ondelete="SET NULL"))
    # statement＋rationale 的 embedding（跟逐字稿片段同一個模型），搜尋與找取代的候選用；算不出來時是空的。
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1024))
    source_revision: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
