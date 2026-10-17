"""對外連線的允許清單（.scratch/pre-launch-hardening/issues/23，ASVS 12.6.1）：不在清單裡的網域不送出；每個對外的 client 都經過它。"""

import asyncio
import importlib
from unittest.mock import patch

import httpx2
import pytest

from app.core import outbound


def answered(seen: list):
    def handler(request):
        seen.append(request.url.host)
        return httpx2.Response(200, text="ok")
    return httpx2.MockTransport(handler)


def test_a_listed_service_is_reached():
    seen = []
    with outbound.client(transport=answered(seen)) as client:
        assert client.get("https://api.openai.com/v1/models").status_code == 200
    assert seen == ["api.openai.com"]


def test_anything_else_is_not_sent():
    seen = []
    with outbound.client(transport=answered(seen)) as client, pytest.raises(outbound.OutboundBlocked, match="evil.example"):
        client.get("https://evil.example/steal")
    with outbound.client(transport=answered(seen)) as client, pytest.raises(outbound.OutboundBlocked):
        client.get("http://169.254.169.254/latest/meta-data")  # cloud metadata
    assert seen == []


def test_the_async_client_checks_too():
    async def call():
        async with outbound.async_client(transport=answered([])) as client:
            await client.get("https://evil.example/")

    with pytest.raises(outbound.OutboundBlocked):
        asyncio.run(call())


def test_the_platform_models_server_is_always_allowed_and_the_list_can_be_replaced():
    with patch.object(outbound.settings, "platform_llm_base_url", "http://llm.internal:8000/v1"), \
         patch.object(outbound.settings, "outbound_allowed_hosts", " mcp.tavily.com , API.Deepl.com"):
        assert outbound.allowed_hosts() == {"mcp.tavily.com", "api.deepl.com", "llm.internal"}


def test_a_blocked_request_is_not_a_transient_failure():
    # The retry rules treat transport errors (connection refused, timeouts) as transient; a blocked host is a setting.
    assert not issubclass(outbound.OutboundBlocked, httpx2.TransportError)


@pytest.mark.parametrize("module", ["provider_keys", "llm_client", "google_calendar", "connections", "model_catalog",
                                    "gmail", "google_tasks"])
def test_every_outbound_client_goes_through_the_allowlist(module):
    client = importlib.import_module(f"app.services.{module}")._http_client
    assert outbound.check in client.event_hooks["request"]


def test_the_hugging_face_client_goes_through_it_too():
    from huggingface_hub.utils._http import get_session

    import app.services.hf_client  # noqa: F401  (sets the factory)

    assert outbound.check in get_session().event_hooks["request"]
