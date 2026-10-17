"""Gmail：自己用 Gmail API 寫的工具，只有建立草稿、不讀信（不用官方遠端 MCP，見 docs/adr/0006）。權限是已連結帳號的 gmail.compose。"""

import base64
from email.message import EmailMessage

import httpx2

from app.core import outbound
from app.services.google_api import google_error_message

_API = "https://gmail.googleapis.com/gmail/v1"
_http_client = outbound.client(timeout=httpx2.Timeout(15.0, connect=5.0))


class GmailError(Exception):
    """Gmail 拒絕或連不上；訊息給使用者看。"""


def create_draft(access_token: str, to: list[str], subject: str, body: str) -> str:
    """在使用者的 Gmail 建立一封草稿（不寄出），回傳打開它的網址。沒有收件人也可以。"""
    message = EmailMessage()
    try:
        if to:
            message["To"] = ", ".join(to)
        message["Subject"] = subject
    except ValueError as exc:  # e.g. a line break in a header
        raise GmailError("收件人或主旨的格式不正確") from exc
    message.set_content(body)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
    try:
        response = _http_client.post(f"{_API}/users/me/drafts", json={"message": {"raw": raw}},
                                     headers={"Authorization": f"Bearer {access_token}"})
    except httpx2.HTTPError as exc:
        raise GmailError("暫時連不上 Gmail，請稍後重試") from exc
    if not response.is_success:
        raise GmailError(f"Gmail 沒有建立這封草稿（HTTP {response.status_code}）{google_error_message(response)}")
    message_id = response.json().get("message", {}).get("id")
    return f"https://mail.google.com/mail/u/0/#drafts?compose={message_id}" if message_id else ""
