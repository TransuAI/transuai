"""Google Tasks：Google 沒有官方的 Tasks MCP，這是自己用 Tasks API 寫的工具（見 docs/adr/0006）。權限是已連結帳號的 tasks。
只用使用者的預設清單（`@default`）：讀它還沒完成的待辦、在它底下建立待辦。"""

import httpx2

from app.services.google_api import google_error_message

_API = "https://tasks.googleapis.com/tasks/v1"
_http_client = httpx2.Client(timeout=httpx2.Timeout(15.0, connect=5.0))


class TasksError(Exception):
    """Google Tasks 拒絕或連不上；訊息給模型與使用者看。"""


def list_open_tasks(access_token: str) -> list[dict]:
    """預設清單裡還沒完成的待辦（標題、期限）。"""
    try:
        response = _http_client.get(f"{_API}/lists/@default/tasks",
                                    params={"showCompleted": "false", "maxResults": "100"},
                                    headers={"Authorization": f"Bearer {access_token}"})
    except httpx2.HTTPError as exc:
        raise TasksError("暫時連不上 Google Tasks") from exc
    if not response.is_success:
        raise TasksError(f"Google Tasks 拒絕了這個請求（HTTP {response.status_code}）")
    # Tasks 的期限只有日期有意義（時間一律是 00:00 UTC）。
    return [{"title": item.get("title", ""), **({"due": item["due"][:10]} if item.get("due") else {})}
            for item in response.json().get("items", [])]


def create_task(access_token: str, title: str, notes: str | None, due: str | None) -> str:
    """在預設清單建立一個待辦（due 是 YYYY-MM-DD），回傳它的網址。"""
    body = {"title": title, **({"notes": notes} if notes else {}), **({"due": f"{due}T00:00:00.000Z"} if due else {})}
    try:
        response = _http_client.post(f"{_API}/lists/@default/tasks", json=body,
                                     headers={"Authorization": f"Bearer {access_token}"})
    except httpx2.HTTPError as exc:
        raise TasksError("暫時連不上 Google Tasks，請稍後重試") from exc
    if not response.is_success:
        raise TasksError(f"Google Tasks 沒有建立這個待辦（HTTP {response.status_code}）{google_error_message(response)}")
    return response.json().get("webViewLink", "")
