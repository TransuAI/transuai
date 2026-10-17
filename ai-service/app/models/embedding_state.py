from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base


class EmbeddingState(Base):
    """哪個 embedding 模型算出了資料庫裡的向量（只有一列）。換模型之後向量就不能跟新的問題比了：啟動時看到設定的模型跟這裡
    不一樣，就把逐字稿片段與決策重算一遍（見 services/embedding_migration）。None＝還沒算過任何向量。"""

    __tablename__ = "embedding_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    model: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
