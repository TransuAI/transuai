import logging
import math
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.db import new_session
from app.repositories.transcription_usage_repository import sum_user_transcription_usage

logger = logging.getLogger(__name__)

# 每月用量跟 gateway 一樣以台灣時間的月份算（gateway 的 UsageMonth）。
_ZONE = ZoneInfo("Asia/Taipei")


class RecordingRefused(Exception):
    """錄音不轉錄（不呼叫語音辨識）的原因；訊息給使用者看，會寫進 Job 的失敗原因。"""


def check_recording(duration_seconds: float | None, owner: uuid.UUID | None) -> None:
    """送去語音辨識之前，用**實際**的長度檢查（ASVS 11.1.5）：上傳時的長度是前端量的，可以亂填，用低位元率把好幾個小時塞進
    檔案大小上限，就能一次超過每月用量。超過單一錄音的上限、或超過這個月剩下的轉錄分鐘數，就 raise RecordingRefused。
    舊訊息沒有擁有者時只檢查單一錄音的上限。"""
    if duration_seconds is None:
        raise RecordingRefused("無法判斷錄音的長度，沒有轉錄")
    # 給人看的分鐘數四捨五入（ffmpeg 量出來常多零點幾秒，61 分鐘不要說成 62）；比較用的是秒。
    minutes = round(duration_seconds / 60)
    if duration_seconds > settings.max_recording_minutes * 60:
        raise RecordingRefused(
            f"錄音長 {minutes} 分鐘，超過每個檔案 {settings.max_recording_minutes} 分鐘的上限，沒有轉錄")
    if owner is None:
        return
    left_seconds = settings.usage_limit_transcription_minutes * 60 - _used_this_month(owner)
    if duration_seconds > left_seconds:
        left_minutes = max(0, math.floor(left_seconds / 60))
        raise RecordingRefused(
            f"這個月的轉錄只剩 {left_minutes} 分鐘（用量上限 {settings.usage_limit_transcription_minutes} 分鐘），"
            f"這個錄音 {minutes} 分鐘，沒有轉錄；下個月 1 日恢復")


def _used_this_month(owner: uuid.UUID) -> float:
    now = datetime.now(_ZONE)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    session = new_session()
    try:
        return sum(row.audio_seconds for row in sum_user_transcription_usage(session, owner, start, end))
    finally:
        session.close()
