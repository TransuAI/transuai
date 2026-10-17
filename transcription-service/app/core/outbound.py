"""對外連線的允許清單（ASVS 12.6.1）：transcription-service 只連語音辨識服務。對外的 HTTP client 用這裡的 client() 建，送出前看網域，
不在清單裡就不送、記 log、raise OutboundBlocked。預設只有 Deepgram；OUTBOUND_ALLOWED_HOSTS（逗號分隔）整份換掉。本地語音辨識伺服器
（STT_BASE_URL，通常是自架的 vLLM）一律自動加進去。
物件儲存（boto3）是內部服務，不經過這裡；網路層的對外限制另外寫在部署清單。"""

import logging
from urllib.parse import urlsplit

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_HOSTS = ("api.deepgram.com",)


class OutboundBlocked(httpx.RequestError):
    """要連的網域不在允許清單裡。不是暫時性的錯誤（不是 TransportError），不重試。"""


def allowed_hosts() -> frozenset[str]:
    configured = [host.strip().lower() for host in settings.outbound_allowed_hosts.split(",") if host.strip()]
    hosts = set(configured or DEFAULT_ALLOWED_HOSTS)
    if local := urlsplit(settings.stt_base_url).hostname:
        hosts.add(local.lower())
    return frozenset(hosts)


def check(request: httpx.Request) -> None:
    host = (request.url.host or "").lower()
    if host not in allowed_hosts():
        logger.warning("blocked an outbound request to %s: not in OUTBOUND_ALLOWED_HOSTS", host)
        raise OutboundBlocked(f"不允許連到 {host}", request=request)


def client(**kwargs) -> httpx.Client:
    return httpx.Client(event_hooks={"request": [check]}, **kwargs)
