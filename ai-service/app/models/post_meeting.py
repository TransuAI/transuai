import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.post_meeting_runs / action_proposals（見 CONTEXT.md「會後處理」「行動提案」）。


class PostMeetingStatus(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    LIMIT_REACHED = "LIMIT_REACHED"  # 到了工具呼叫次數或時間的上限；已經產生的提案保留
    FAILED = "FAILED"


class ProposalStatus(StrEnum):
    PROPOSED = "PROPOSED"  # 等使用者確認
    DONE = "DONE"
    FAILED = "FAILED"


class TodoDestination(StrEnum):
    GOOGLE_TASKS = "google_tasks"
    NOTION = "notion"  # 使用者指定的 Notion 待辦資料庫


class PostMeetingRun(Base):
    """一次會後處理（使用者對一個 Job 手動啟動的 agent）。"""

    __tablename__ = "post_meeting_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # 目前在做什麼（給使用者看，例如「正在查詢你的行事曆…」）。
    progress: Mapped[str] = mapped_column(Text, nullable=False, default="")
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # 瀏覽器的時區與 Job 的上傳時間：換算相對日期用。
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    # 這一次（重試也算新的一次）開始跑的時間；「執行中」是否卡住從這裡算。還沒開始跑是空的（從 requested_at 算）。
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ActionProposal(Base):
    """行動提案：agent 想做、等使用者確認才執行的一個寫入動作（服務、種類、要送出的參數）。"""

    __tablename__ = "action_proposals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("post_meeting_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    service: Mapped[str] = mapped_column(String(32), nullable=False)  # 例如 google_calendar
    tool: Mapped[str] = mapped_column(String(64), nullable=False)  # 確認後要呼叫的工具，例如 calendar_create_event
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # 例如 calendar_event，決定前端的表單
    # 要送出的參數；執行時換成使用者確認的最終參數。
    arguments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=ProposalStatus.PROPOSED)
    result_url: Mapped[str | None] = mapped_column(Text)  # 執行成功時，建立好的項目的網址
    failure_reason: Mapped[str | None] = mapped_column(Text)  # 執行失敗時給使用者看的原因
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PostMeetingSettings(Base):
    """一位使用者的會後處理設定：Notion 的會議紀錄父頁面、待辦資料庫（沒指定是空的）。"""

    __tablename__ = "post_meeting_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    notion_meetings_page_id: Mapped[str | None] = mapped_column(String(64))
    notion_meetings_page_title: Mapped[str | None] = mapped_column(Text)
    notion_meetings_page_url: Mapped[str | None] = mapped_column(Text)
    # 資料庫的 data source ID（collection://…），新增一筆時當 parent。
    notion_todo_data_source_id: Mapped[str | None] = mapped_column(String(64))
    notion_todo_database_title: Mapped[str | None] = mapped_column(Text)
    notion_todo_database_url: Mapped[str | None] = mapped_column(Text)
    # 待辦要建在哪裡（TodoDestination）；還沒選過是 Google Tasks。
    todo_destination: Mapped[str] = mapped_column(String(20), nullable=False, default=TodoDestination.GOOGLE_TASKS)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
