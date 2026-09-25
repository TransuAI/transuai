from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import pipeline
from app.services.transcriber import TranscriptResult


@pytest.fixture
def mocks():
    """驅動 `process_message()` 這個 seam 的共用 mocking boundary：pipeline 會碰到的外部 I/O（Groq、下載、
    抽音軌、gRPC 狀態回報、DB session / 存檔）全部 patch 在 pipeline 模組「使用端」import 進來的名稱
    （跟 ai-service/tests/test_pipeline_retry.py 同一種做法），並預先設好 happy-path 的回傳值。"""
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "download_object", return_value=Path("/tmp/fake-download.mp3")) as download_object,
        patch.object(pipeline, "extract_audio_track") as extract_audio_track,
        patch.object(pipeline, "transcribe") as transcribe,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_transcript") as save_transcript,
        patch("pathlib.Path.unlink"),
    ):
        transcribe.return_value = TranscriptResult(language="English", full_text="", segments=[])
        yield SimpleNamespace(
            job_status_client=job_status_client,
            download_object=download_object,
            extract_audio_track=extract_audio_track,
            transcribe=transcribe,
            save_transcript=save_transcript,
        )
