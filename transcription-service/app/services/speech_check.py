"""系統設定頁的「測試連線」：用目前的設定（存的或環境變數）試一下語音辨識，告訴管理員哪裡不對。"""

import httpx

from app.core import outbound
from app.services import speech_settings

_DEEPGRAM_PROJECTS = "https://api.deepgram.com/v1/projects"
# 管理員在頁面上等著：很快放棄。測試會換掉它。
_client = outbound.client(timeout=httpx.Timeout(10.0, connect=5.0))


def check() -> tuple[bool, str]:
    config = speech_settings.current()
    if config.local:
        headers = {"Authorization": f"Bearer {config.stt_api_key}"} if config.stt_api_key else {}
        try:
            response = _client.get(f"{config.stt_base_url.rstrip('/')}/models", headers=headers)
        except httpx.HTTPError as exc:
            return False, f"連不上 {config.stt_base_url}：{exc}"
        if response.status_code != 200:
            return False, f"伺服器回 HTTP {response.status_code}"
        try:
            served = [entry.get("id") for entry in response.json().get("data", [])]
        except ValueError:
            return False, "伺服器回的不是 OpenAI 相容的模型清單"
        if config.stt_model not in served:
            return False, f"伺服器上沒有「{config.stt_model}」（有：{'、'.join(filter(None, served)) or '沒有任何模型'}）"
        return True, f"本地語音辨識 {config.stt_model} 可以用"
    if config.deepgram_api_key:
        # 列出專案不收費，只看金鑰對不對。
        try:
            response = _client.get(_DEEPGRAM_PROJECTS, headers={"Authorization": f"Token {config.deepgram_api_key}"})
        except httpx.HTTPError as exc:
            return False, f"連不上 Deepgram：{exc}"
        if response.status_code in (401, 403):
            return False, "Deepgram 拒絕了這把金鑰"
        if response.status_code != 200:
            return False, f"Deepgram 回 HTTP {response.status_code}"
        return True, "Deepgram 的金鑰可以用"
    return False, "還沒有設定語音辨識（本地伺服器或 Deepgram 金鑰）"
