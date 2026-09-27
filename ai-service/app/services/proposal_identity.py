"""一個行動提案建立的是「哪一件事」：用來認出同一件事被提第二次（見 CONTEXT.md「行動提案」）。

每種提案取出標題與時間；指紋是「服務、種類、正規化後的標題、時間」。正規化去掉全形半形、大小寫、空白與標點的差別，時間
換成 UTC 到分鐘——同一個活動寫成 +08:00 或 Z 是同一件事。沒有標題就沒有指紋（認不出是哪一件事，不能讓沒標題的都算同一件）。
只看參數，不需要外部服務連著。"""

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from app.services.agent_tools import normalize_text


def _text(args: dict[str, Any], name: str) -> str:
    value = args.get(name)
    return value if isinstance(value, str) else ""


def _minute(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ") if parsed.tzinfo else value


def _notion_item_title(args: dict[str, Any]) -> str:
    properties = args.get("properties")
    title = properties.get(args.get("title_property")) if isinstance(properties, dict) else None
    return str(title) if title is not None else ""


# 種類 → (給人看的名稱, 取出（標題, 時間）)
_KINDS: dict[str, tuple[str, Callable[[dict[str, Any]], tuple[str, str]]]] = {
    "calendar_event": ("行事曆活動", lambda args: (_text(args, "summary"), _minute(_text(args, "start")))),
    "email_draft": ("email 草稿", lambda args: (_text(args, "subject"), "")),
    "google_task": ("Google Tasks 待辦", lambda args: (_text(args, "title"), _text(args, "due"))),
    "notion_page": ("Notion 頁面", lambda args: (_text(args, "title"), "")),
    "notion_database_item": ("Notion 待辦", lambda args: (_notion_item_title(args), "")),
}


def _title_and_time(kind: str, args: dict[str, Any]) -> tuple[str, str]:
    known = _KINDS.get(kind)
    return known[1](args) if known else ("", "")


def fingerprint(service: str, kind: str, args: dict[str, Any]) -> str | None:
    title, when = _title_and_time(kind, args)
    normalized = normalize_text(title)
    return "|".join((service, kind, normalized, when)) if normalized else None


def describe(kind: str, args: dict[str, Any]) -> str:
    """給模型看的一行，例如「行事曆活動：搬家確認會議（2026-11-18T06:00Z）」。"""
    title, when = _title_and_time(kind, args)
    label = _KINDS[kind][0] if kind in _KINDS else kind
    return f"{label}：{title}" + (f"（{when}）" if when else "")
