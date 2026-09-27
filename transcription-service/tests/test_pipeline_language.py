"""轉錄語言（見 docs/adr/0002）：transcription.requested 帶的語言交給語音辨識；升級前的舊訊息沒有，用設定的預設（中文）。"""

import json
import uuid
from unittest.mock import MagicMock

import pytest

from app.services import pipeline


def _process(language: str | None) -> None:
    payload = {"jobId": str(uuid.uuid4()), "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}
    if language is not None:
        payload["transcriptionLanguage"] = language
    pipeline.process_message(json.dumps(payload).encode("utf-8"), MagicMock(), MagicMock())


@pytest.mark.parametrize("language", ["zh-TW", "en", "auto"])
def test_the_upload_s_language_is_used_to_recognise_speech(mocks, language):
    _process(language)

    assert mocks.recognize.call_args.args[1] == language


def test_a_message_from_before_languages_existed_is_recognised_as_chinese(mocks):
    _process(None)

    assert mocks.recognize.call_args.args[1] is None  # recognize() falls back to the configured language (zh-TW)
