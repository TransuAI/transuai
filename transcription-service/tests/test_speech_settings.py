"""系統設定的「語音辨識」（.scratch/system-settings/issues/05）：設定頁存過就用存的、沒存過用環境變數；金鑰加密存、不回傳；存了馬上
生效；可以回到環境變數；測試連線說哪裡不對。"""

from unittest.mock import patch

import grpc
import httpx
import pytest
from sqlalchemy import text

from app.core import outbound
from app.proto_gen import transcription_pb2
from app.services import speech_check, speech_recognition, speech_settings


def local(**overrides):
    values = dict(stt_base_url="http://gpu-box:8002/v1", stt_model="MediaTek-Research/Breeze-ASR-25",
                  diarization_threshold=0.7)
    return transcription_pb2.UpdateSpeechSettingsRequest(**(values | overrides))


def test_out_of_the_box_nothing_is_set_up(transcription_stub, db_session):
    with patch.object(speech_settings.settings, "deepgram_api_key", ""):
        answer = transcription_stub.GetSpeechSettings(transcription_pb2.GetSpeechSettingsRequest())

    assert answer.from_environment and answer.active == "none"


def test_saved_local_recognition_takes_effect_at_once(transcription_stub, db_session):
    answer = transcription_stub.UpdateSpeechSettings(local(stt_api_key="local-secret"))

    assert answer.active == "local" and not answer.from_environment and answer.stt_api_key_set
    assert "local-secret" not in str(answer)
    assert (speech_recognition.provider(), speech_recognition.model_name()) == ("local", "MediaTek-Research/Breeze-ASR-25")
    assert "gpu-box" in outbound.allowed_hosts()
    assert speech_settings.current().diarization_threshold == 0.7
    stored = db_session.execute(text("SELECT stt_api_key FROM speech_settings")).scalar_one()
    assert b"local-secret" not in bytes(stored)


def test_deepgram_only_when_no_local_server_is_set(transcription_stub, db_session):
    answer = transcription_stub.UpdateSpeechSettings(local(stt_base_url="", deepgram_api_key="dg-secret"))

    assert answer.active == "deepgram" and answer.deepgram_api_key_set
    assert speech_settings.current().deepgram_api_key == "dg-secret"


def test_going_back_to_the_environment(transcription_stub, db_session):
    transcription_stub.UpdateSpeechSettings(local())

    answer = transcription_stub.UpdateSpeechSettings(transcription_pb2.UpdateSpeechSettingsRequest(use_environment=True))

    assert answer.from_environment


def test_a_threshold_out_of_range_is_refused(transcription_stub, db_session):
    with pytest.raises(grpc.RpcError) as raised:
        transcription_stub.UpdateSpeechSettings(local(diarization_threshold=0))

    assert raised.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_the_check_says_whether_the_local_server_has_the_model(transcription_stub, db_session, monkeypatch):
    monkeypatch.setattr(speech_check, "_client", httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={"data": [{"id": "MediaTek-Research/Breeze-ASR-25"}]}))))
    transcription_stub.UpdateSpeechSettings(local())
    good = transcription_stub.CheckSpeechSettings(transcription_pb2.CheckSpeechSettingsRequest())
    transcription_stub.UpdateSpeechSettings(local(stt_model="missing"))
    bad = transcription_stub.CheckSpeechSettings(transcription_pb2.CheckSpeechSettingsRequest())

    assert good.ok
    assert not bad.ok and "missing" in bad.detail
