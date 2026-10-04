import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 事實查核（見 CONTEXT.md「主張」「查核」、.scratch/fact-check、services/fact_checks.py）：每個 Job 一筆標出主張的紀錄（狀態、模型、依據的
# revision），主張一條一列；查核的結果（結論、說明、來源）記在那一條上。重新標出時查核過的保留，其他的換掉。


class FactCheckStatus(StrEnum):
    GENERATING = "GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Verdict(StrEnum):
    """查核的結論（不用「正確／錯誤」）。"""

    SUPPORTED = "supported"  # 有依據
    DISPUTED = "disputed"  # 有出入
    NO_RELIABLE_SOURCE = "no_reliable_source"  # 查不到可靠來源
    NOT_CHECKABLE = "not_checkable"  # 無法查核（只有說話者自己知道的事）：標出來時就決定，不給勾選


class FactCheck(Base):
    __tablename__ = "fact_checks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    # 最近一次要求標出主張的使用者：用他的預設模型、用量記在他名下。
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


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    speaker_label: Mapped[str | None] = mapped_column(String(32))
    start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)  # 說這句話的那個片段的原話
    claim: Mapped[str] = mapped_column(Text, nullable=False)  # 整理成一句完整、可以搜尋的陳述（查核時只送這一句）
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # number / fact
    # 查核的結論；空的是還沒查（not_checkable 是標出來時就決定的）。
    verdict: Mapped[str | None] = mapped_column(String(24))
    explanation: Mapped[str | None] = mapped_column(Text)
    # 結論依據的網頁：[{title, url, excerpt}]，順序就是說明裡 [n] 的編號。
    sources: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    check_model_provider: Mapped[str | None] = mapped_column(String(32))
    check_model: Mapped[str | None] = mapped_column(String(200))
    # 查核中（開始的時間）；查完或失敗時清掉。卡住太久當成失敗。
    checking_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 上一次查核失敗的原因（例如搜尋失敗）；那一條保持還沒查。
    check_error: Mapped[str | None] = mapped_column(Text)
    # 標出這條主張時的逐字稿 revision：比目前的小就是依據舊版的。
    source_revision: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
