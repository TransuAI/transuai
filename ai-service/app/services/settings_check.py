"""系統設定頁的「測試連線」：用目前的設定（存的或環境變數）試一下平台模型與 embedding 的伺服器，告訴管理員哪裡不對。"""

from dataclasses import dataclass

import httpx2

from app.core import outbound
from app.services import embedder, system_settings

# 管理員在頁面上等著：很快放棄。測試會換掉它。
_http_client = outbound.client(timeout=httpx2.Timeout(10.0, connect=5.0))


@dataclass(frozen=True)
class SettingsCheck:
    platform_ok: bool
    platform_detail: str
    embedding_ok: bool
    embedding_detail: str


def check() -> SettingsCheck:
    platform_ok, platform_detail = _check_platform()
    embedding_ok, embedding_detail = _check_embedding()
    return SettingsCheck(platform_ok, platform_detail, embedding_ok, embedding_detail)


def _check_platform() -> tuple[bool, str]:
    config = system_settings.current()
    if not config.platform_base_url or not config.platform_model:
        return False, "還沒有設定平台模型的伺服器與模型"
    headers = {"Authorization": f"Bearer {config.platform_api_key}"} if config.platform_api_key else {}
    try:
        response = _http_client.get(f"{config.platform_base_url.rstrip('/')}/models", headers=headers)
    except httpx2.HTTPError as exc:
        return False, f"連不上 {config.platform_base_url}：{exc}"
    if response.status_code in (401, 403):
        return False, f"伺服器拒絕了金鑰（HTTP {response.status_code}）"
    if response.status_code != 200:
        return False, f"伺服器回 HTTP {response.status_code}"
    try:
        served = [entry.get("id") for entry in response.json().get("data", [])]
    except ValueError:
        return False, "伺服器回的不是 OpenAI 相容的模型清單"
    if config.platform_model not in served:
        return False, f"伺服器上沒有「{config.platform_model}」（有：{'、'.join(filter(None, served)) or '沒有任何模型'}）"
    return True, f"{config.platform_model} 可以用"


def _check_embedding() -> tuple[bool, str]:
    config = system_settings.current()
    if not embedder.is_configured():
        return False, "沒有設定 embedding（問答只會根據摘要與章節回答）"
    try:
        embedder.embed_documents(["測試"])
    except Exception as exc:
        return False, str(exc)
    return True, f"{config.embedding_model} 可以用（{embedder.DIMENSIONS} 維）"
