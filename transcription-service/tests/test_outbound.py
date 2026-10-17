"""對外連線的允許清單（.scratch/pre-launch-hardening/issues/23，ASVS 12.6.1）：只連語音辨識服務，其他網域不送出、也不算暫時性失敗。"""

from unittest.mock import patch

import httpx
import pytest

from app.core import outbound
from app.services import speech_recognition


def answered(seen: list):
    def handler(request):
        seen.append(request.url.host)
        return httpx.Response(200, json={})
    return httpx.MockTransport(handler)


def test_deepgram_is_reached_and_nothing_else_is_sent():
    seen = []
    with outbound.client(transport=answered(seen)) as client:
        client.post("https://api.deepgram.com/v1/listen")
        with pytest.raises(outbound.OutboundBlocked, match="evil.example"):
            client.post("https://evil.example/listen")
    assert seen == ["api.deepgram.com"]


def test_the_list_can_be_replaced():
    with patch.object(outbound.settings, "outbound_allowed_hosts", "asr.internal, API.Deepgram.com"):
        assert outbound.allowed_hosts() == {"asr.internal", "api.deepgram.com"}


def test_the_speech_recognition_client_goes_through_it_and_a_blocked_host_is_not_retried():
    assert outbound.check in speech_recognition._client.event_hooks["request"]
    blocked = outbound.OutboundBlocked("不允許連到 evil.example", request=httpx.Request("POST", "https://evil.example/"))
    assert not speech_recognition.is_transient_recognition_error(blocked)
