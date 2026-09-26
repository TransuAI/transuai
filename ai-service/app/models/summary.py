import uuid
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, Text

# Schema 對應 ../architecture-design.md 4.4 ai_db.summaries。
# 改了這裡（或其他 model）的欄位要一起新增 Alembic migration（app/db/migrations，見 README
# 「資料庫 migration」），服務啟動時才會套用到資料庫。
#
# 文件裡 ai_db 還定義了 export_outputs，但 MVP 目前還沒做多格式輸出，先不建不用的表。
# chapters 表見 chapter.py，embeddings/qa_history 見 embedding.py / qa_history.py。


class Base(DeclarativeBase):
    pass


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True, index=True)
    summary_text: Mapped[str | None] = mapped_column(Text)
    # 這份摘要（跟同一次產生的章節）是依據逐字稿的哪個 revision 產生的；逐字稿之後再被編輯
    # （revision 變大）就代表它們過時了（見 CONTEXT.md「過時」）。
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
