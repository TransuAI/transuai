"""自己寫的 Google API 工具（日曆、Gmail）共用的小東西。"""

import httpx2


def google_error_message(response: httpx2.Response) -> str:
    """Google 自己的說明（例如「Calendar usage limits exceeded.」），接在錯誤訊息後面，使用者才知道發生什麼事。"""
    try:
        message = response.json().get("error", {}).get("message")
    except ValueError:
        return ""
    return f"：{message}" if message else ""
