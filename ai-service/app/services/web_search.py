"""網路搜尋（見 CONTEXT.md「網路搜尋」）：問答開了「查網路」時、事實查核每查一條主張時，用 Tavily 的官方遠端 MCP 查一次，
ai-service 是 MCP client。
金鑰是平台的（`TAVILY_API_KEY`，放在 Authorization header，不放進網址）；沒設定就是這個功能關閉。

每次搜尋開一次連線（一題、一條主張只查一次，不值得維持長連線）。測試把 `server_override` 換成程式內的假 MCP server（MCP SDK 會直接在
程式裡接上它），其他都照正式的路徑走。"""

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from app.core.config import settings

TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/"
# 用量紀錄上的搜尋服務名稱。
PROVIDER = "tavily"
server_override: Any = None

# 一般搜尋（basic，1 credit），最多 5 筆；每筆的內容截短再給模型，整題的 prompt 才不會被網頁撐大。
_MAX_RESULTS = 5
_MAX_CONTENT_CHARS = 600
# 使用者正在等回答：查不到就不等了，只根據這段內容回答。
_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class WebSource:
    """回答依據的一個網頁（網路來源）：給使用者看、跟著問答紀錄保存的部分。"""

    title: str
    url: str


@dataclass(frozen=True)
class WebPage:
    """一筆搜尋結果：網頁與它的內容摘錄（問答的摘錄只給模型看，不保存；查核把引用的摘錄跟著來源存起來，給使用者對照）。"""

    source: WebSource
    content: str

    @property
    def site(self) -> str:
        host = urlparse(self.source.url).hostname or ""
        return host.removeprefix("www.")


@dataclass(frozen=True)
class WebSearchResult:
    """一題查網路的結果：放進回答依據的網路來源（順序就是 [n] 的編號），或是搜尋失敗。"""

    sources: list[WebSource]
    failed: bool


class WebSearchFailed(Exception):
    """搜尋服務連不上、逾時或拒絕了這次搜尋。"""


def is_available() -> bool:
    """這個部署能不能查網路：有設定搜尋服務的金鑰。"""
    return bool(settings.tavily_api_key)


def search(query: str) -> list[WebPage]:
    """用一句搜尋查詢查網路，回傳最多 5 筆結果；失敗 raise WebSearchFailed。"""
    try:
        return asyncio.run(asyncio.wait_for(_search(query), _TIMEOUT_SECONDS))
    except WebSearchFailed:
        raise
    except Exception as exc:
        raise WebSearchFailed(f"web search failed: {exc!r}") from exc


async def _search(query: str) -> list[WebPage]:
    arguments = {"query": query, "max_results": _MAX_RESULTS, "search_depth": "basic"}
    if server_override is not None:
        async with Client(server_override) as client:
            result = await client.call_tool("tavily_search", arguments)
    else:
        async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
                                      timeout=httpx2.Timeout(_TIMEOUT_SECONDS)) as http:
            async with Client(streamable_http_client(TAVILY_MCP_URL, http_client=http)) as client:
                result = await client.call_tool("tavily_search", arguments)
    text = "\n".join(getattr(part, "text", "") for part in result.content).strip()
    if result.is_error:
        raise WebSearchFailed(f"Tavily refused the search: {text[:300]}")
    return _pages(text)


# Tavily 的結果是 JSON（`results`：title、url、content）；拒絕時也可能是一般的回應，只是內容是帶 `code` 的 JSON（例如額度用完）。
# 萬一回的是純文字，也接受「Title: / URL: / Content:」一段一段的格式。
_TEXT_RESULT = re.compile(r"Title:\s*(?P<title>.*?)\s*\n\s*URL:\s*(?P<url>\S+)\s*\n\s*Content:\s*(?P<content>.*?)(?=\n\s*Title:|\Z)",
                          re.DOTALL)


def _pages(text: str) -> list[WebPage]:
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        if not isinstance(data.get("results"), list):
            raise WebSearchFailed(f"Tavily answered without results: {text[:300]}")
        raw = [(item.get("title"), item.get("url"), item.get("content"))
               for item in data["results"] if isinstance(item, dict)]
    else:
        raw = [(m["title"], m["url"], m["content"]) for m in _TEXT_RESULT.finditer(text)]
    pages = []
    for title, url, content in raw:
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            continue
        title = title.strip() if isinstance(title, str) and title.strip() else urlparse(url).hostname or url
        content = content.strip() if isinstance(content, str) else ""
        if len(content) > _MAX_CONTENT_CHARS:
            content = content[:_MAX_CONTENT_CHARS] + "…"
        pages.append(WebPage(WebSource(title=title, url=url), content))
    return pages[:_MAX_RESULTS]
