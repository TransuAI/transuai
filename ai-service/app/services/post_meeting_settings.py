"""會後處理的設定（見 CONTEXT.md「會後處理」）：Notion 的會議紀錄父頁面與待辦資料庫。儲存前用 Notion MCP 確認存在而且讀得到。"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import cache

from app.db import new_session
from app.models import PostMeetingSettings
from app.services import connections
from app.services.notion import NotionError, NotionUnreachable, call_tool, data_source_of, page_id_from, title_of


@dataclass(frozen=True)
class NotionLocation:
    id: str  # 頁面 ID，或資料庫的 data source ID（collection://…）
    title: str
    url: str


@dataclass(frozen=True)
class Settings:
    meetings_page: NotionLocation | None
    todo_database: NotionLocation | None


class NotionNotLinked(Exception):
    pass


class InvalidLocation(Exception):
    """The URL isn't a page (or database) Notion lets us read; the message says so, for the user."""


def get_settings(user_id: uuid.UUID) -> Settings:
    session = new_session()
    try:
        row = session.get(PostMeetingSettings, user_id)
    finally:
        session.close()
    if row is None:
        return Settings(None, None)
    return Settings(
        NotionLocation(row.notion_meetings_page_id, row.notion_meetings_page_title or "", row.notion_meetings_page_url or "")
        if row.notion_meetings_page_id else None,
        NotionLocation(row.notion_todo_data_source_id, row.notion_todo_database_title or "", row.notion_todo_database_url or "")
        if row.notion_todo_data_source_id else None,
    )


def save_settings(user_id: uuid.UUID, meetings_page_url: str, todo_database_url: str) -> Settings:
    """整份換掉；空字串是不指定。改過的位置先向 Notion 確認（NotionUnreachable 讓呼叫端回 UNAVAILABLE）；沒改的沿用，
    不再問 Notion——之後設定頁多了別的欄位，存那些欄位不會因為 Notion 連不上而失敗。"""
    meetings_page_url, todo_database_url = meetings_page_url.strip(), todo_database_url.strip()
    current = get_settings(user_id)
    token = cache(lambda: _notion_token(user_id))
    page = _kept_or_checked(current.meetings_page, meetings_page_url, lambda: _check_page(token(), meetings_page_url))
    database = _kept_or_checked(current.todo_database, todo_database_url,
                                lambda: _check_database(token(), todo_database_url))
    session = new_session()
    try:
        row = session.get(PostMeetingSettings, user_id) or PostMeetingSettings(user_id=user_id)
        row.notion_meetings_page_id, row.notion_meetings_page_title, row.notion_meetings_page_url = (
            (page.id, page.title, page.url) if page else (None, None, None))
        row.notion_todo_data_source_id, row.notion_todo_database_title, row.notion_todo_database_url = (
            (database.id, database.title, database.url) if database else (None, None, None))
        row.updated_at = datetime.now(timezone.utc)
        session.merge(row)
        session.commit()
    finally:
        session.close()
    return Settings(page, database)


def _kept_or_checked(current: NotionLocation | None, url: str,
                     check: Callable[[], NotionLocation]) -> NotionLocation | None:
    if not url:
        return None
    if current is not None and current.url == url:
        return current
    return check()


def _notion_token(user_id: uuid.UUID) -> str:
    try:
        return connections.access_token(user_id, "notion")
    except (connections.NotConnected, connections.ConnectionInvalid) as exc:
        raise NotionNotLinked() from exc


_NOT_READABLE = "找不到這個 Notion {what}，或 TransuAI 沒有權限讀取（請在 Notion 把它分享給 TransuAI）"


def _fetch(token: str, url: str, what: str) -> str:
    try:
        return call_tool(token, "notion-fetch", {"id": url})
    except NotionUnreachable:
        raise
    except NotionError as exc:
        raise InvalidLocation(_NOT_READABLE.format(what=what)) from exc


def _check_page(token: str, url: str) -> NotionLocation:
    page_id = page_id_from(url)
    if page_id is None:
        raise InvalidLocation("這不是 Notion 頁面的網址")
    text = _fetch(token, url, "頁面")
    if data_source_of(text) is not None:
        raise InvalidLocation("這是 Notion 資料庫，會議紀錄要建在一個頁面底下")
    return NotionLocation(page_id, title_of(text) or "未命名頁面", url)


def _check_database(token: str, url: str) -> NotionLocation:
    text = _fetch(token, url, "資料庫")
    data_source = data_source_of(text)
    if data_source is None:
        raise InvalidLocation("這不是 Notion 資料庫，待辦要寫進資料庫")
    return NotionLocation(data_source, title_of(text) or "未命名資料庫", url)
