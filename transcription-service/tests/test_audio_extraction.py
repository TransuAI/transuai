"""抽影片音軌（moviepy + imageio-ffmpeg）真的能跑——pillow 被覆蓋成 moviepy 沒宣告支援的版本（見 pyproject.toml 的 [tool.uv]）。"""

import subprocess
from pathlib import Path

import imageio_ffmpeg
import pytest

from app.services.audio import extract_audio_track


def make_video(path: Path, *, with_audio: bool) -> Path:
    command = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
               "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10"]
    if with_audio:
        command += ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest"]
    subprocess.run([*command, str(path)], check=True)
    return path


def test_the_audio_track_is_extracted_to_mp3(tmp_path):
    audio = extract_audio_track(make_video(tmp_path / "talk.mp4", with_audio=True))
    try:
        assert audio.suffix == ".mp3"
        assert audio.stat().st_size > 0
    finally:
        audio.unlink(missing_ok=True)


def test_a_video_without_audio_is_refused(tmp_path):
    with pytest.raises(RuntimeError, match="no audio track"):
        extract_audio_track(make_video(tmp_path / "silent.mp4", with_audio=False))
