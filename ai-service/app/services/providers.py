"""自有金鑰支援的 AI 廠商（固定清單，不開放自訂網址：伺服器不能被拿來連到任意位置）。每家都有 OpenAI 相容的
chat completions 端點（見 docs/adr/0004），以及一支不收費、需要金鑰的查詢 API，用來在存入前驗證金鑰。"""

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class Provider:
    id: str
    # OpenAI 相容的網址（chat completions 走這裡）
    base_url: str
    # 驗證金鑰用的 GET 請求：網址，以及依金鑰組出的 headers
    key_check_url: str
    key_check_headers: Callable[[str], dict[str, str]]


def _bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


PROVIDERS: dict[str, Provider] = {
    provider.id: provider for provider in (
        Provider("openai", "https://api.openai.com/v1", "https://api.openai.com/v1/models", _bearer),
        Provider(
            "anthropic", "https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/models",
            lambda key: {"x-api-key": key, "anthropic-version": "2023-06-01"},
        ),
        Provider(
            "gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
            "https://generativelanguage.googleapis.com/v1beta/models", lambda key: {"x-goog-api-key": key},
        ),
        # OpenRouter 的模型清單不需要金鑰，分不出金鑰對錯；查詢「目前這把金鑰」的 API 才需要。
        Provider("openrouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/key", _bearer),
    )
}
