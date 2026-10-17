"""系統設定的「模型」部分（見 .scratch/system-settings/spec.md）：平台模型、會後處理模型、embedding、網路搜尋。

管理員在系統設定頁存過就用存的（ai_settings 那一列），沒存過就用環境變數（app/core/config.py）。所有用到這些設定的地方都問
`current()`，所以設定頁存了馬上生效、不用重啟。讀資料庫的結果記幾秒，存檔時清掉。
"""

import logging
import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db import new_session
from app.models import AiSettings
from app.services import key_encryption

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 5.0
_ROW = 1


@dataclass(frozen=True)
class AiConfig:
    platform_base_url: str
    platform_api_key: str
    platform_model: str
    post_meeting_model: str
    embedding_base_url: str
    embedding_api_key: str
    embedding_model: str
    embedding_query_instruction: str
    web_search_api_key: str
    # 用的是環境變數（設定頁沒存過）。
    from_environment: bool


@dataclass(frozen=True)
class AiSettingsUpdate:
    """設定頁送來的：金鑰是 None 就是不改，空字串就是清掉。"""

    platform_base_url: str
    platform_model: str
    post_meeting_model: str
    embedding_base_url: str
    embedding_model: str
    embedding_query_instruction: str
    platform_api_key: str | None = None
    embedding_api_key: str | None = None
    web_search_api_key: str | None = None


_lock = threading.Lock()
_cached_row: tuple[float, AiSettings | None] | None = None


def environment() -> AiConfig:
    return AiConfig(
        platform_base_url=settings.platform_llm_base_url, platform_api_key=settings.platform_llm_api_key,
        platform_model=settings.platform_llm_model, post_meeting_model=settings.ai_post_meeting_platform_model,
        embedding_base_url=settings.embedding_base_url, embedding_api_key=settings.embedding_api_key,
        embedding_model=settings.embedding_model, embedding_query_instruction=settings.embedding_query_instruction,
        web_search_api_key=settings.tavily_api_key, from_environment=True)


def current() -> AiConfig:
    row = _saved_row()
    return environment() if row is None else _from_row(row)


def save(update: AiSettingsUpdate) -> AiConfig:
    """存設定頁送來的設定。第一次存、又沒填某把金鑰時，沿用環境變數的（不然存了反而少了金鑰）。換了 embedding 模型就在背景重算向量。"""
    before = current()
    with new_session() as session:
        row = session.get(AiSettings, _ROW)
        first_save = row is None
        if first_save:
            row = AiSettings(id=_ROW)
            session.add(row)
        row.platform_base_url = update.platform_base_url.strip()
        row.platform_model = update.platform_model.strip()
        row.post_meeting_model = update.post_meeting_model.strip()
        row.embedding_base_url = update.embedding_base_url.strip()
        row.embedding_model = update.embedding_model.strip()
        row.embedding_query_instruction = update.embedding_query_instruction.strip()
        for field, given, inherited in (("platform_api_key", update.platform_api_key, before.platform_api_key),
                                        ("embedding_api_key", update.embedding_api_key, before.embedding_api_key),
                                        ("web_search_api_key", update.web_search_api_key, before.web_search_api_key)):
            value = inherited if given is None and first_save else given
            if value is not None:
                setattr(row, field, key_encryption.encrypt(value, bound_to=f"ai_settings:{field}") if value else None)
        row.updated_at = datetime.now(timezone.utc)
        session.commit()
    _forget()
    after = current()
    _after_change(before, after)
    return after


def use_environment() -> AiConfig:
    """刪掉存的設定，回到環境變數。"""
    before = current()
    with new_session() as session:
        if (row := session.get(AiSettings, _ROW)) is not None:
            session.delete(row)
            session.commit()
    _forget()
    after = current()
    _after_change(before, after)
    return after


def _after_change(before: AiConfig, after: AiConfig) -> None:
    if (before.embedding_base_url, before.embedding_model) != (after.embedding_base_url, after.embedding_model):
        # 跟啟動時一樣：換了模型就重算、缺的補算（見 embedding_migration）。
        from app.services.embedding_migration import sync_embeddings

        threading.Thread(target=sync_embeddings, name="embedding-sync", daemon=True).start()


def _saved_row() -> AiSettings | None:
    global _cached_row
    with _lock:
        if _cached_row is not None and time.monotonic() - _cached_row[0] < _CACHE_SECONDS:
            return _cached_row[1]
    try:
        with new_session() as session:
            row = session.scalar(select(AiSettings).where(AiSettings.id == _ROW))
            if row is not None:
                session.expunge(row)
    except Exception:
        # 讀不到資料庫（剛啟動、暫時斷線）時照用環境變數；不記進快取，下次再讀。
        logger.warning("could not read the saved AI settings, using the environment", exc_info=True)
        return None
    with _lock:
        _cached_row = (time.monotonic(), row)
    return row


def _forget() -> None:
    global _cached_row
    with _lock:
        _cached_row = None


def _from_row(row: AiSettings) -> AiConfig:
    def secret(field: str) -> str:
        stored = getattr(row, field)
        return key_encryption.decrypt(stored, bound_to=f"ai_settings:{field}") if stored else ""

    return replace(environment(), platform_base_url=row.platform_base_url, platform_api_key=secret("platform_api_key"),
                   platform_model=row.platform_model, post_meeting_model=row.post_meeting_model,
                   embedding_base_url=row.embedding_base_url, embedding_api_key=secret("embedding_api_key"),
                   embedding_model=row.embedding_model, embedding_query_instruction=row.embedding_query_instruction,
                   web_search_api_key=secret("web_search_api_key"), from_environment=False)
