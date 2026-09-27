"""Notion：官方遠端 MCP（`mcp.notion.com`）的 client，ai-service 是 MCP client。權杖是已連結帳號的 Notion 存取權杖。

每次呼叫開一次連線（會後處理一次最多十幾次工具呼叫，不值得維持長連線）。測試把 `server_override` 換成程式內的假 MCP
server（MCP SDK 會直接在程式裡接上它），其他都照正式的路徑走。"""

import asyncio
import json
import re
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

NOTION_MCP_URL = "https://mcp.notion.com/mcp"
server_override: Any = None


class NotionError(Exception):
    """Notion 拒絕或連不上；訊息給使用者（與模型）看。"""


class NotionUnreachable(NotionError):
    pass


def call_tool(access_token: str, name: str, arguments: dict[str, Any]) -> str:
    """呼叫 Notion MCP 的一個工具，回傳它的文字結果；工具回報錯誤時 raise NotionError，連不上 raise NotionUnreachable。"""
    return asyncio.run(_call_tool(access_token, name, arguments))


async def _call_tool(access_token: str, name: str, arguments: dict[str, Any]) -> str:
    try:
        if server_override is not None:
            async with Client(server_override) as client:
                result = await client.call_tool(name, arguments)
        else:
            async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {access_token}"},
                                          timeout=httpx2.Timeout(30.0, connect=10.0)) as http:
                async with Client(streamable_http_client(NOTION_MCP_URL, http_client=http)) as client:
                    result = await client.call_tool(name, arguments)
    except Exception as exc:
        raise NotionUnreachable("暫時連不上 Notion，請稍後再試") from exc
    text = "\n".join(getattr(part, "text", "") for part in result.content).strip()
    if result.is_error:
        raise NotionError(f"Notion 拒絕了這個請求：{text[:300]}")
    return text


# notion-fetch / notion-create-pages 的結果是給模型看的文字（常見是 JSON）；這裡只挑需要的欄位，挑不到就寬鬆地找。
_DATA_SOURCE = re.compile(r"collection://[0-9a-fA-F-]{36}")
_URL = re.compile(r"https://(?:www\.)?notion\.so/[^\s\"'<>)]+")
_TITLE = re.compile(r"\"title\"\s*:\s*\"([^\"]+)\"")


def _as_json(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def title_of(text: str) -> str:
    data = _as_json(text)
    if isinstance(data.get("title"), str):
        return data["title"]
    match = _TITLE.search(text)
    return match.group(1) if match else ""


def data_source_of(text: str) -> str | None:
    data = _as_json(text)
    if isinstance(data.get("data_source_id"), str):
        return data["data_source_id"]
    match = _DATA_SOURCE.search(text)
    return match.group(0) if match else None


def url_of(text: str) -> str:
    match = _URL.search(text)
    return match.group(0) if match else ""


def page_id_from(url_or_id: str) -> str | None:
    """Notion 網址或 ID 裡的頁面 ID（最後 32 個十六進位字元），格式化成帶連字號的 UUID。"""
    compact = re.findall(r"[0-9a-fA-F]{32}", url_or_id.replace("-", ""))
    if not compact:
        return None
    hex_id = compact[-1].lower()
    return f"{hex_id[:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:]}"
