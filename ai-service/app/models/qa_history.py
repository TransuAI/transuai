import uuid
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Boolean, Numeric, String, Text, false, text

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.qa_history。
# 依 job_id 讀取（見 qa_repository.find_by_job_id）同時供兩種用途：ListQaHistory RPC 回傳
# 完整歷史給前端顯示，AskQuestion 只取最近幾輪當作對話記憶餵給 LLM。一個 job 只有一段連續
# 對話，沒有獨立的 conversation/thread 概念，見 docs/adr/0002-single-conversation-per-job.md。


class QaHistory(Base):
    __tablename__ = "qa_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    source_timestamps: Mapped[list[float]] = mapped_column(ARRAY(Numeric(10, 2)))
    # 回答這一則的模型；記錄模型之前的問答是空的。
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    # 這一題有沒有查網路（見 CONTEXT.md「網路搜尋」）；查了但搜尋失敗時 web_sources 是空的。
    web_search: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    # 回答依據的網路來源 [{"title", "url"}]，順序就是回答裡 [n] 的編號。
    web_sources: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
