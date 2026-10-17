"""會後處理的設定（見 CONTEXT.md「會後處理」）：Notion 的會議紀錄位置——每場會議的會議紀錄（含待辦清單）建成這個頁面底下的
子頁面（儲存前用 Notion MCP 確認讀得到而且是頁面，見 docs/adr/0009）——以及待辦要放在 Notion 會議紀錄裡還是 Google Tasks。"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from app.db import new_session
from app.models import PostMeetingSettings, TodoDestination
from app.services import connections
from app.services.notion import NotionError, NotionUnreachable, call_tool, object_type_of, page_id_from, title_of


@dataclass(frozen=True)
class NotionLocation:
    id: str  # 頁面 ID
    title: str
    url: str


@dataclass(frozen=True)
class Settings:
    meetings_page: NotionLocation | None
    todo_destination: TodoDestination = TodoDestination.GOOGLE_TASKS


class NotionNotLinked(Exception):
    pass


class InvalidLocation(Exception):
    """The URL isn't a Notion page we can read; the message says so, for the user."""


def get_settings(user_id: uuid.UUID) -> Settings:
    session = new_session()
    try:
        row = session.get(PostMeetingSettings, user_id)
    finally:
        session.close()
    if row is None:
        return Settings(None)
    return Settings(
        NotionLocation(row.notion_meetings_page_id, row.notion_meetings_page_title or "", row.notion_meetings_page_url or "")
        if row.notion_meetings_page_id else None,
        TodoDestination(row.todo_destination),
    )


def save_settings(user_id: uuid.UUID, meetings_page_url: str, todo_destination: TodoDestination | None = None) -> Settings:
    """整份換掉；網址是空字串是不指定，todo_destination 是 None 就維持原本的。網址改過時先向 Notion 確認
    （NotionUnreachable 讓呼叫端回 UNAVAILABLE）；沒改的沿用、不再問 Notion——只換待辦去處不會因為 Notion 連不上而失敗。"""
    meetings_page_url = meetings_page_url.strip()
    current = get_settings(user_id)
    if not meetings_page_url:
        page = None
    elif current.meetings_page is not None and current.meetings_page.url == meetings_page_url:
        page = current.meetings_page
    else:
        page = _check_page(_notion_token(user_id), meetings_page_url)
    destination = todo_destination or current.todo_destination
    session = new_session()
    try:
        row = session.get(PostMeetingSettings, user_id) or PostMeetingSettings(user_id=user_id)
        row.notion_meetings_page_id, row.notion_meetings_page_title, row.notion_meetings_page_url = (
            (page.id, page.title, page.url) if page else (None, None, None))
        row.todo_destination = destination
        row.updated_at = datetime.now(timezone.utc)
        session.merge(row)
        session.commit()
    finally:
        session.close()
    return Settings(page, destination)


def _notion_token(user_id: uuid.UUID) -> str:
    try:
        return connections.access_token(user_id, "notion")
    except (connections.NotConnected, connections.ConnectionInvalid) as exc:
        raise NotionNotLinked() from exc


def _check_page(token: str, url: str) -> NotionLocation:
    page_id = page_id_from(url)
    if page_id is None:
        raise InvalidLocation("這不是 Notion 頁面的連結")
    try:
        text = call_tool(token, "notion-fetch", {"id": url})
    except NotionUnreachable:
        raise
    except NotionError as exc:
        # Notion's MCP works with the user's own access: if they can open the page, so can we. Nothing to share.
        raise InvalidLocation("找不到這個 Notion 頁面：請確認連結正確，而且你的 Notion 帳號打得開它") from exc
    # Notion 標明了種類；頁面裡嵌了表格照樣是頁面。看不出種類（格式變了）就當成頁面，交給建立時的結果。
    kind = object_type_of(text)
    if kind is not None and kind != "page":
        raise InvalidLocation("這是 Notion 資料庫，請改貼一個一般頁面的連結")
    return NotionLocation(page_id, title_of(text) or "未命名頁面", url)
