"""系統設定的「語音辨識」（見 .scratch/system-settings/spec.md）：本地的語音辨識伺服器（OpenAI 相容的 /v1/audio/transcriptions）、
Deepgram 的金鑰、講者分離的門檻。

管理員在系統設定頁存過就用存的（speech_settings 那一列），沒存過就用環境變數（app/core/config.py）。用到這些設定的地方都問
`current()`，存了馬上生效、不用重啟。讀資料庫的結果記幾秒，存檔時清掉。
"""

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db import new_session
from app.models import SpeechSettings
from app.services import key_encryption

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 5.0
_ROW = 1


@dataclass(frozen=True)
class SpeechConfig:
    stt_base_url: str
    stt_api_key: str
    stt_model: str
    deepgram_api_key: str
    diarization_threshold: float
    from_environment: bool

    @property
    def local(self) -> bool:
        return bool(self.stt_base_url and self.stt_model)


@dataclass(frozen=True)
class SpeechSettingsUpdate:
    """設定頁送來的：金鑰是 None 就是不改，空字串就是清掉。"""

    stt_base_url: str
    stt_model: str
    diarization_threshold: float
    stt_api_key: str | None = None
    deepgram_api_key: str | None = None


_lock = threading.Lock()
_cached_row: tuple[float, SpeechSettings | None] | None = None


def environment() -> SpeechConfig:
    return SpeechConfig(stt_base_url=settings.stt_base_url, stt_api_key=settings.stt_api_key, stt_model=settings.stt_model,
                        deepgram_api_key=settings.deepgram_api_key,
                        diarization_threshold=settings.diarization_threshold, from_environment=True)


def current() -> SpeechConfig:
    row = _saved_row()
    if row is None:
        return environment()

    def secret(field: str) -> str:
        stored = getattr(row, field)
        return key_encryption.decrypt(stored, bound_to=f"speech_settings:{field}") if stored else ""

    return SpeechConfig(stt_base_url=row.stt_base_url, stt_api_key=secret("stt_api_key"), stt_model=row.stt_model,
                        deepgram_api_key=secret("deepgram_api_key"), diarization_threshold=row.diarization_threshold,
                        from_environment=False)


def save(update: SpeechSettingsUpdate) -> SpeechConfig:
    """存設定頁送來的設定。第一次存、又沒填某把金鑰時，沿用環境變數的（不然存了反而少了金鑰）。"""
    before = current()
    with new_session() as session:
        row = session.get(SpeechSettings, _ROW)
        first_save = row is None
        if first_save:
            row = SpeechSettings(id=_ROW)
            session.add(row)
        row.stt_base_url = update.stt_base_url.strip()
        row.stt_model = update.stt_model.strip()
        row.diarization_threshold = update.diarization_threshold
        for field, given, inherited in (("stt_api_key", update.stt_api_key, before.stt_api_key),
                                        ("deepgram_api_key", update.deepgram_api_key, before.deepgram_api_key)):
            value = inherited if given is None and first_save else given
            if value is not None:
                setattr(row, field, key_encryption.encrypt(value, bound_to=f"speech_settings:{field}") if value else None)
        row.updated_at = datetime.now(timezone.utc)
        session.commit()
    _forget()
    return current()


def use_environment() -> SpeechConfig:
    """刪掉存的設定，回到環境變數。"""
    with new_session() as session:
        if (row := session.get(SpeechSettings, _ROW)) is not None:
            session.delete(row)
            session.commit()
    _forget()
    return current()


def _saved_row() -> SpeechSettings | None:
    global _cached_row
    with _lock:
        if _cached_row is not None and time.monotonic() - _cached_row[0] < _CACHE_SECONDS:
            return _cached_row[1]
    try:
        with new_session() as session:
            row = session.scalar(select(SpeechSettings).where(SpeechSettings.id == _ROW))
            if row is not None:
                session.expunge(row)
    except Exception:
        logger.warning("could not read the saved speech settings, using the environment", exc_info=True)
        return None
    with _lock:
        _cached_row = (time.monotonic(), row)
    return row


def _forget() -> None:
    global _cached_row
    with _lock:
        _cached_row = None
