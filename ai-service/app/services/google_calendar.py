"""Google 日曆：自己用 Calendar API 寫的工具（不用官方遠端 MCP，見 docs/adr/0006）。權限是已連結帳號的 calendar.events。"""

import httpx2

from app.core import outbound
from app.services.google_api import google_error_message

_API = "https://www.googleapis.com/calendar/v3"
_http_client = outbound.client(timeout=httpx2.Timeout(15.0, connect=5.0))


class CalendarError(Exception):
    """Google 日曆拒絕或連不上；訊息給模型與使用者看。"""


def list_events(access_token: str, time_min: str, time_max: str) -> list[dict]:
    """使用者主要日曆在 [time_min, time_max) 之間的行程（標題、開始、結束），依開始時間排序。"""
    try:
        response = _http_client.get(
            f"{_API}/calendars/primary/events",
            params={"timeMin": time_min, "timeMax": time_max, "singleEvents": "true", "orderBy": "startTime",
                    "maxResults": "50"},
            headers={"Authorization": f"Bearer {access_token}"})
    except httpx2.HTTPError as exc:
        raise CalendarError("暫時連不上 Google 日曆") from exc
    if not response.is_success:
        raise CalendarError(f"Google 日曆拒絕了這個請求（HTTP {response.status_code}）")
    return [{"summary": item.get("summary", "（沒有標題）"),
             "start": item.get("start", {}).get("dateTime") or item.get("start", {}).get("date"),
             "end": item.get("end", {}).get("dateTime") or item.get("end", {}).get("date")}
            for item in response.json().get("items", [])]


def create_event(access_token: str, summary: str, start: str, end: str, description: str | None) -> str:
    """在使用者的主要日曆建立一個活動，回傳它的網址。"""
    body = {"summary": summary, "start": {"dateTime": start}, "end": {"dateTime": end},
            **({"description": description} if description else {})}
    try:
        response = _http_client.post(f"{_API}/calendars/primary/events", json=body,
                                     headers={"Authorization": f"Bearer {access_token}"})
    except httpx2.HTTPError as exc:
        raise CalendarError("暫時連不上 Google 日曆，請稍後重試") from exc
    if not response.is_success:
        raise CalendarError(f"Google 日曆沒有建立這個活動（HTTP {response.status_code}）{google_error_message(response)}")
    return response.json().get("htmlLink", "")
