"""本地語音辨識（docs/adr/0003）：先分講者、每段講者的話送到自架 vLLM 的 /v1/audio/transcriptions。講者分離與解碼是假的，
vLLM 用 httpx 的 MockTransport。"""

import json
from types import SimpleNamespace

import httpx
import numpy as np
import pytest

from app.services import diarization, local_speech, speech_recognition
from app.services.diarization import SAMPLE_RATE, SpeakerTurn
from app.services.local_speech import MAX_CHUNK_SECONDS, _Chunk, _chunks
from app.services.speech_recognition import RecognitionNotConfigured, is_transient_recognition_error, recognize


def turn(start, end, speaker):
    return SpeakerTurn(start, end, speaker)


# --- 要送去轉錄的段落 ---


def test_a_speakers_turns_close_together_become_one_chunk_and_a_new_speaker_starts_another():
    assert _chunks([turn(0.0, 2.0, "0"), turn(2.5, 6.0, "0"), turn(6.2, 9.0, "1")], 10.0) == [
        _Chunk(0.0, 6.0, "0"), _Chunk(6.2, 9.0, "1")]


def test_two_people_talking_at_once_is_transcribed_once():
    assert _chunks([turn(0.0, 5.0, "0"), turn(4.0, 8.0, "1")], 10.0) == [_Chunk(0.0, 5.0, "0"), _Chunk(5.0, 8.0, "1")]


def test_a_long_turn_is_cut_into_whisper_sized_chunks():
    chunks = _chunks([turn(0.0, 70.0, "0")], 70.0)

    assert [(c.start, c.end) for c in chunks] == [(0.0, 30.0), (30.0, 60.0), (60.0, 70.0)]
    assert all(c.end - c.start <= MAX_CHUNK_SECONDS for c in chunks)


def test_a_breath_is_not_sent_on_its_own():
    assert _chunks([turn(0.0, 0.3, "0"), turn(3.0, 6.0, "1")], 10.0) == [_Chunk(3.0, 6.0, "1")]


def test_without_diarization_the_whole_recording_is_sent_in_windows_without_speakers():
    assert _chunks(None, 45.0) == [_Chunk(0.0, 30.0, None), _Chunk(30.0, 45.0, None)]


# --- 轉錄 ---


@pytest.fixture
def server(monkeypatch):
    """vLLM answering every chunk with the queued `server.answers` (in order); records each request."""
    state = SimpleNamespace(requests=[], answers=[])

    def handler(request: httpx.Request) -> httpx.Response:
        request.read()
        state.requests.append(request)
        return state.answers.pop(0) if state.answers else httpx.Response(200, json={"language": "zh", "segments": []})

    monkeypatch.setattr(local_speech, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(speech_recognition.settings, "stt_base_url", "http://vllm.test:8002/v1")
    monkeypatch.setattr(speech_recognition.settings, "stt_model", "MediaTek-Research/Breeze-ASR-25")
    monkeypatch.setattr(local_speech, "_CONCURRENT_REQUESTS", 1)  # answers are queued in order
    monkeypatch.setattr(local_speech, "_decode", lambda _path: np.zeros(20 * SAMPLE_RATE, dtype=np.float32))
    return state


def answer(language, *segments):
    return httpx.Response(200, json={"language": language, "text": " ".join(t for _, _, t in segments),
                                     "segments": [{"start": s, "end": e, "text": t} for s, e, t in segments]})


def test_each_speakers_words_come_back_at_their_place_in_the_recording(server, monkeypatch, tmp_path):
    monkeypatch.setattr(diarization, "is_available", lambda: True)
    monkeypatch.setattr(diarization, "diarize", lambda _path: [turn(0.0, 6.0, "0"), turn(8.0, 15.0, "1")])
    server.answers = [answer("zh", (0.0, 2.5, " 大家好 "), (2.5, 6.0, "今天談預算")), answer("zh", (0.0, 4.0, "我同意"))]

    recognition = recognize(tmp_path / "meeting.mp3", "zh-TW")

    assert [(w.start, w.end, w.text, w.speaker) for w in recognition.words] == [
        (0.0, 2.5, "大家好", "0"), (2.5, 6.0, "今天談預算", "0"), (8.0, 12.0, "我同意", "1")]
    assert recognition.language == "zh-TW"
    assert recognition.audio_seconds == 20.0


def test_it_asks_the_configured_model_for_timed_segments_in_the_chosen_language(server, monkeypatch, tmp_path):
    monkeypatch.setattr(diarization, "is_available", lambda: False)

    recognize(tmp_path / "meeting.mp3", "zh-TW")

    request = server.requests[0]
    assert str(request.url) == "http://vllm.test:8002/v1/audio/transcriptions"
    body = request.content.decode("latin-1")
    for name, value in [("model", "MediaTek-Research/Breeze-ASR-25"), ("language", "zh"),
                        ("response_format", "verbose_json"), ("timestamp_granularities[]", "segment")]:
        assert f'name="{name}"\r\n\r\n{value}\r\n' in body
    assert 'filename="chunk.wav"' in body and "RIFF" in body  # a 16 kHz WAV of the chunk


def test_with_automatic_detection_the_language_most_chunks_heard_wins(server, monkeypatch, tmp_path):
    monkeypatch.setattr(diarization, "is_available", lambda: True)
    monkeypatch.setattr(diarization, "diarize", lambda _path: [turn(0.0, 3.0, "0"), turn(4.0, 7.0, "1"), turn(8.0, 11.0, "0")])
    server.answers = [answer("en", (0.0, 1.0, "hi")), answer("en", (0.0, 1.0, "hello")), answer("zh", (0.0, 1.0, "好"))]

    recognition = recognize(tmp_path / "meeting.mp3", "auto")

    assert recognition.language == "en"
    assert all('name="language"' not in r.content.decode("latin-1") for r in server.requests)


def test_a_chunk_that_fails_for_a_moment_is_tried_again_on_its_own(server, monkeypatch, tmp_path):
    monkeypatch.setattr(local_speech, "_CHUNK_RETRY_DELAYS_SECONDS", (0, 0))
    monkeypatch.setattr(diarization, "is_available", lambda: True)
    monkeypatch.setattr(diarization, "diarize", lambda _path: [turn(2.0, 6.0, "0")])
    server.answers = [httpx.Response(503, text="busy"), httpx.Response(429, text="slow down"), answer("zh", (0.0, 1.0, "好"))]

    recognition = recognize(tmp_path / "meeting.mp3", "zh-TW")

    assert [w.text for w in recognition.words] == ["好"]
    assert len(server.requests) == 3


def test_a_busy_server_is_worth_retrying_and_a_bad_request_is_not(server, monkeypatch, tmp_path):
    monkeypatch.setattr(local_speech, "_CHUNK_RETRY_DELAYS_SECONDS", (0, 0))
    monkeypatch.setattr(diarization, "is_available", lambda: False)
    for status, transient in [(503, True), (400, False)]:
        server.answers = [httpx.Response(status, json={"error": "no"})] * 3
        with pytest.raises(httpx.HTTPStatusError) as raised:
            recognize(tmp_path / "meeting.mp3", "zh-TW")
        assert is_transient_recognition_error(raised.value) is transient


def test_a_chunk_the_server_cannot_time_comes_back_as_one_segment(server, monkeypatch, tmp_path):
    # vLLM 0.31 answers 500 when it can't build segment times for an almost-empty result; the text alone still works.
    monkeypatch.setattr(diarization, "is_available", lambda: True)
    monkeypatch.setattr(diarization, "diarize", lambda _path: [turn(2.0, 6.0, "0")])
    server.answers = [httpx.Response(500, text="Internal Server Error"), httpx.Response(200, json={"text": " 嗯 "})]

    recognition = recognize(tmp_path / "meeting.mp3", "zh-TW")

    assert [(w.start, w.end, w.text, w.speaker) for w in recognition.words] == [(2.0, 6.0, "嗯", "0")]
    assert 'name="response_format"\r\n\r\njson\r\n' in server.requests[1].content.decode("latin-1")


def test_when_the_text_alone_fails_too_the_first_error_counts(server, monkeypatch, tmp_path):
    monkeypatch.setattr(diarization, "is_available", lambda: False)
    monkeypatch.setattr(local_speech, "_CHUNK_RETRY_DELAYS_SECONDS", (0, 0))
    server.answers = [httpx.Response(500, text="no")] + [httpx.Response(503, text="busy")] * 3

    with pytest.raises(httpx.HTTPStatusError) as raised:
        recognize(tmp_path / "meeting.mp3", "zh-TW")
    assert raised.value.response.status_code == 500


def test_when_diarization_runs_out_of_memory_the_recording_is_still_transcribed_without_speakers(server, monkeypatch, tmp_path):
    def killed(_path):
        raise diarization.DiarizationFailed("the process ended early")

    monkeypatch.setattr(diarization, "is_available", lambda: True)
    monkeypatch.setattr(diarization, "diarize", killed)
    server.answers = [answer("zh", (0.0, 2.0, "大家好"))]

    recognition = recognize(tmp_path / "meeting.mp3", "zh-TW")

    assert [(w.text, w.speaker) for w in recognition.words] == [("大家好", None)]


# --- 用哪一個 ---


def test_the_local_server_is_used_and_recorded_as_such_when_it_is_set(server):
    assert (speech_recognition.provider(), speech_recognition.model_name()) == ("local", "MediaTek-Research/Breeze-ASR-25")


def test_nothing_is_set_up_out_of_the_box(monkeypatch, tmp_path):
    monkeypatch.setattr(speech_recognition.settings, "stt_base_url", "")
    monkeypatch.setattr(speech_recognition.settings, "deepgram_api_key", "")

    with pytest.raises(RecognitionNotConfigured, match="語音辨識尚未設定"):
        recognize(tmp_path / "meeting.mp3", "zh-TW")
    assert not is_transient_recognition_error(RecognitionNotConfigured("x"))
