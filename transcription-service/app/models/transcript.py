import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Schema 對應 infra/architecture-design.md 4.3 transcription_db。改了這裡的欄位要一起新增 Alembic
# migration（app/db/migrations，見 README「資料庫 migration」），服務啟動時才會套用到資料庫。


class Base(DeclarativeBase):
    pass


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    language: Mapped[str | None] = mapped_column(String(10))
    full_text: Mapped[str | None] = mapped_column(Text)
    # 每次實際改動逐字稿（編輯）就 +1。目的是讓 AI 產出記錄自己依據的版本、比對出是否過時。
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))

    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="TranscriptSegment.sequence_no",
    )
    speakers: Mapped[list["Speaker"]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="Speaker.display_order",
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    end_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    # 說這個片段的講者（Speaker.label）；None＝沒有講者資訊（講者分離之前的舊 Job）。
    speaker_label: Mapped[str | None] = mapped_column(String(50))
    # 目前的文字；空字串＝已清空片段（見 CONTEXT.md）。
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # 人工編輯前的機器產出（原始文字），永遠不變，供還原使用。
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)

    transcript: Mapped["Transcript"] = relationship(back_populates="segments")


class Speaker(Base):
    """講者分離找出的一位講者（見 CONTEXT.md「講者」），範圍只在這份逐字稿內。"""

    __tablename__ = "speakers"
    __table_args__ = (UniqueConstraint("transcript_id", "label"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    # 這個 Job 內的標籤（S1、S2…），片段的 speaker_label 指向它。
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    # 從 1 開始，決定預設名稱「講者 N」與前端的顏色。
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # 使用者取的名稱；None＝沒有取名，顯示預設名稱。
    name: Mapped[str | None] = mapped_column(String(100))

    transcript: Mapped["Transcript"] = relationship(back_populates="speakers")

    @property
    def default_name(self) -> str:
        return f"講者 {self.display_order}"

    @property
    def display_name(self) -> str:
        return self.name or self.default_name

    def set_name(self, name: str | None) -> None:
        """取名；None 或等於預設名稱「講者 N」＝沒有自訂名稱。"""
        self.name = None if name == self.default_name else name


class TranscriptionUsage(Base):
    """轉錄用量（見 CONTEXT.md「轉錄用量」）：每次呼叫語音辨識服務一筆，記在 Job 擁有者名下。"""

    __tablename__ = "transcription_usage"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 升級當下還在佇列裡、沒帶 userId 的舊訊息，使用者是空的。
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    # 服務沒回報（例如呼叫失敗）時是 NULL（未知），不是 0。
    audio_seconds: Mapped[float | None] = mapped_column(Float)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class DeletedJob(Base):
    """upload-service 刪掉的 Job（收到 `job.deleted` 時記下，保留一天）：刪除之後才寫進來的逐字稿要丟掉（見 services/job_deletion）。"""

    __tablename__ = "deleted_jobs"

    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
