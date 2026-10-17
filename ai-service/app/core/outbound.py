"""對外連線的允許清單（ASVS 12.6.1）：ai-service 只連設定好的外部服務。每個對外的 HTTP client 都用這裡的 client()／async_client()
建（或掛上 check），送出前看網域，不在清單裡就不送、記 log、raise OutboundBlocked。

清單預設是程式裡用到的服務（下面的 DEFAULT_ALLOWED_HOSTS）；部署者用 OUTBOUND_ALLOWED_HOSTS（逗號分隔）整份換掉，例如拿掉不用的廠商。
平台模型的網址（PLATFORM_LLM_BASE_URL，可能是自架的伺服器）一律自動加進去。網路層的對外限制另外寫在部署清單。
"""

import logging
from urllib.parse import urlsplit

import httpx2

from app.core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_HOSTS = (
    # 平台模型（HF 的路由）與 embedding（huggingface_hub 先到 huggingface.co 查模型由哪個供應商跑）
    "router.huggingface.co", "huggingface.co",
    # 網路搜尋（問答「查網路」、事實查核）
    "mcp.tavily.com",
    # 已連結的帳號：Notion（MCP 與 OAuth）、Google（OAuth、日曆、Gmail、Tasks）
    "mcp.notion.com",
    "oauth2.googleapis.com", "www.googleapis.com", "gmail.googleapis.com", "tasks.googleapis.com",
    # 使用者自有金鑰的廠商
    "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "openrouter.ai",
)


class OutboundBlocked(httpx2.RequestError):
    """要連的網域不在允許清單裡（設定錯了，或有東西想連到不該連的地方）。不是暫時性的錯誤，不重試。"""


def allowed_hosts() -> frozenset[str]:
    configured = [host.strip().lower() for host in settings.outbound_allowed_hosts.split(",") if host.strip()]
    hosts = set(configured or DEFAULT_ALLOWED_HOSTS)
    platform = urlsplit(settings.platform_llm_base_url).hostname
    if platform:
        hosts.add(platform.lower())
    return frozenset(hosts)


def check(request) -> None:
    """httpx2 與 httpx 的 request event hook（兩者的 request 都有 .url.host）。"""
    host = (request.url.host or "").lower()
    if host not in allowed_hosts():
        logger.warning("blocked an outbound request to %s: not in OUTBOUND_ALLOWED_HOSTS", host)
        raise OutboundBlocked(f"不允許連到 {host}", request=request)


async def acheck(request) -> None:
    check(request)


def client(**kwargs) -> httpx2.Client:
    return httpx2.Client(event_hooks={"request": [check]}, **kwargs)


def async_client(**kwargs) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(event_hooks={"request": [acheck]}, **kwargs)
