import logging
import os
import tempfile
from pathlib import Path

from moviepy import VideoFileClip
from moviepy.video.io.ffmpeg_reader import ffmpeg_parse_infos

logger = logging.getLogger(__name__)


def extract_audio_track(video_path: Path) -> Path:
    """把影片的音軌抽成 mp3，回傳暫存音檔路徑（呼叫端負責之後刪除）。

    底層是 moviepy，經 imageio-ffmpeg 自動下載/管理 ffmpeg binary，
    本機不需要另外裝系統的 ffmpeg。
    """
    fd, out_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    out = Path(out_path)

    logger.info("extracting audio track from %s -> %s", video_path, out)
    with VideoFileClip(str(video_path)) as clip:
        if clip.audio is None:
            out.unlink(missing_ok=True)
            raise RuntimeError(f"video has no audio track: {video_path}")
        clip.audio.write_audiofile(str(out), logger=None)
    return out


def media_duration_seconds(path: Path) -> float | None:
    """錄音或影片的長度（秒），由 ffmpeg 讀檔頭與串流資訊，不解碼；讀不出來（不是媒體檔、壞檔）回 None。"""
    try:
        duration = ffmpeg_parse_infos(str(path)).get("duration")
    except (OSError, RuntimeError, ValueError):
        logger.warning("could not read the duration of %s", path, exc_info=True)
        return None
    return float(duration) if duration else None
