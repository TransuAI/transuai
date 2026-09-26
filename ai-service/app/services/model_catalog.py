"""使用者可以選的模型（見 CONTEXT.md「預設模型」）。OpenAI、Anthropic、Gemini 是我們整理、確認過能用的清單，每個模型
標示能不能呼叫工具（會後處理需要）；OpenRouter 有好幾百個模型，讓使用者自己輸入模型 ID，用 OpenRouter 公開的模型清單確認
存在，能不能呼叫工具看它回報的 `supported_parameters`。清單要跟著廠商的模型汰換更新。"""

from dataclasses import dataclass

import httpx2

@dataclass(frozen=True)
class ModelChoice:
    provider: str  # PLATFORM，或廠商名稱
    model: str
    supports_tools: bool


CURATED_MODELS: dict[str, list[ModelChoice]] = {
    "openai": [
        ModelChoice("openai", "gpt-5", True),
        ModelChoice("openai", "gpt-5-mini", True),
        ModelChoice("openai", "gpt-4.1-mini", True),
    ],
    "anthropic": [
        ModelChoice("anthropic", "claude-opus-5-5", True),
        ModelChoice("anthropic", "claude-sonnet-5", True),
        ModelChoice("anthropic", "claude-haiku-4-5-20251001", True),
    ],
    "gemini": [
        ModelChoice("gemini", "gemini-2.5-pro", True),
        ModelChoice("gemini", "gemini-2.5-flash", True),
    ],
}

OPENROUTER = "openrouter"
_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# 使用者在設定頁等著的請求：很快放棄。測試會換掉它。
_http_client = httpx2.Client(timeout=httpx2.Timeout(10.0, connect=5.0))


class UnknownModel(Exception):
    """這個廠商沒有這個模型（不在整理好的清單裡，或 OpenRouter 上不存在）。"""


class CatalogUnreachable(Exception):
    """OpenRouter 的模型清單暫時查不到，沒辦法確認模型存在。"""


def curated_model(provider: str, model: str) -> ModelChoice:
    for choice in CURATED_MODELS.get(provider, []):
        if choice.model == model:
            return choice
    raise UnknownModel(f"{provider} 沒有「{model}」這個可選的模型")


def openrouter_model(model: str) -> ModelChoice:
    try:
        response = _http_client.get(_OPENROUTER_MODELS_URL)
        response.raise_for_status()
        listed = response.json().get("data", [])
    except (httpx2.HTTPError, ValueError) as exc:
        raise CatalogUnreachable("暫時查不到 OpenRouter 的模型清單，請稍後再試") from exc
    for entry in listed:
        if entry.get("id") == model:
            return ModelChoice(OPENROUTER, model, "tools" in (entry.get("supported_parameters") or []))
    raise UnknownModel(f"OpenRouter 上找不到「{model}」這個模型")

