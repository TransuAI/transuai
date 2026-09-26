"""語音辨識 adapter 的廠商邊界：用 ADR 0001 實測時錄下的真實 Deepgram 回應（32 秒的訪談片段）驗證解析，
HTTP 層用 httpx 的 MockTransport。"""

import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app.services import speech_recognition
from app.services.speech_recognition import RecognizedWord, is_transient_recognition_error, recognize

FIXTURE = Path(__file__).parent / "fixtures" / "deepgram_nova3_zh_tw_interview.json"


@pytest.fixture
def deepgram(monkeypatch):
    """Answers every request with `deepgram.response` (the recorded fixture unless a test replaces it) and
    records the requests in `deepgram.requests`."""
    state = SimpleNamespace(requests=[], response=httpx.Response(200, json=json.loads(FIXTURE.read_text())))

    def handler(request: httpx.Request) -> httpx.Response:
        request.read()
        state.requests.append(request)
        return state.response

    monkeypatch.setattr(speech_recognition, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(speech_recognition.settings, "deepgram_api_key", "test-key")
    return state


@pytest.fixture
def audio(tmp_path) -> Path:
    path = tmp_path / "audio.mp3"
    path.write_bytes(b"fake audio bytes")
    return path


def test_uploads_the_audio_itself_asking_for_diarized_traditional_chinese(deepgram, audio):
    recognize(audio)

    [request] = deepgram.requests
    assert request.url.host == "api.deepgram.com"
    assert request.content == b"fake audio bytes"
    assert request.headers["Authorization"] == "Token test-key"
    assert dict(request.url.params) == {
        "model": "nova-3",
        "language": "zh-TW",
        "diarize": "true",
        "smart_format": "true",
        "punctuate": "true",
    }


def test_parses_every_word_with_its_times_and_speaker(deepgram, audio):
    recognition = recognize(audio)

    assert recognition.language == "zh-TW"
    assert len(recognition.words) == 84
    assert recognition.words[0] == RecognizedWord(start=0.16, end=0.64, text="已經開始", speaker="0")
    assert recognition.words[-1] == RecognizedWord(start=31.920937, end=33.440937, text="過", speaker="0")


def test_reports_how_many_seconds_of_audio_were_recognised(deepgram, audio):
    assert recognize(audio).audio_seconds == 32.076


def test_a_response_without_a_duration_has_unknown_audio_seconds(deepgram, audio):
    deepgram.response = httpx.Response(200, json={"results": {"channels": [{"alternatives": [{"words": []}]}]}})

    assert recognize(audio).audio_seconds is None


def test_keeps_the_vendor_speaker_turns(deepgram, audio):
    words = recognize(audio).words

    turns = [(i, w.speaker) for i, w in enumerate(words) if i == 0 or w.speaker != words[i - 1].speaker]
    assert turns == [(0, "0"), (24, "1"), (41, "0"), (45, "1"), (75, "0"), (82, "1"), (83, "0")]


def test_a_response_without_speakers_gives_words_without_speaker(deepgram, audio):
    deepgram.response = httpx.Response(200, json={"results": {"channels": [{"alternatives": [{
        "words": [{"word": "hello", "punctuated_word": "Hello.", "start": 0.5, "end": 0.9}],
    }]}]}})

    assert recognize(audio).words == [RecognizedWord(start=0.5, end=0.9, text="Hello.", speaker=None)]


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_rate_limits_and_server_errors_are_transient(deepgram, audio, status):
    deepgram.response = httpx.Response(status)

    with pytest.raises(httpx.HTTPStatusError) as raised:
        recognize(audio)
    assert is_transient_recognition_error(raised.value) is True


@pytest.mark.parametrize("status", [400, 401, 402, 403])
def test_bad_audio_auth_and_exhausted_credit_are_permanent(deepgram, audio, status):
    deepgram.response = httpx.Response(status)

    with pytest.raises(httpx.HTTPStatusError) as raised:
        recognize(audio)
    assert is_transient_recognition_error(raised.value) is False


@pytest.mark.parametrize("exc", [
    httpx.ReadTimeout("timed out"),
    httpx.ConnectError("connection refused"),
])
def test_timeouts_and_connection_failures_are_transient(exc):
    assert is_transient_recognition_error(exc) is True


def test_other_exceptions_are_permanent():
    assert is_transient_recognition_error(ValueError("not an HTTP error")) is False
