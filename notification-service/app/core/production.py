"""正式環境（`APP_ENV=production`）的啟動檢查：必要的密鑰沒設、還是開發用的預設值、或太短，就拒絕啟動並說出是哪幾個環境變數——
少設一個不能默默用開發值跑起來。開發環境不檢查。每個服務各有一份（各自的目錄），檢查的密鑰不同。"""

from app.core.config import Settings

# 各服務設定裡的開發用預設值（跟 infra/k8s/02-secret.yaml 一致）。
_DEVELOPMENT_DEFAULTS = frozenset({"", "0000", "00000000", "admin", "dev-only-shared-secret-change-me-before-any-real-deployment"})
# 設定欄位（環境變數是它的大寫）與最短長度；JWT 密鑰被猜到就能冒充任何人，跟 gateway 一樣要 32 字元。
_REQUIRED = {"rabbitmq_password": 12, "jwt_secret": 32}


def secret_problems(settings: Settings) -> list[str]:
    """正式環境下有問題的密鑰（空的就是沒問題；不是正式環境一律沒問題）。"""
    if not settings.is_production:
        return []
    problems = []
    for field, min_length in _REQUIRED.items():
        value = getattr(settings, field)
        if value in _DEVELOPMENT_DEFAULTS:
            problems.append(f"{field.upper()} is not set (or is the development default)")
        elif len(value) < min_length:
            problems.append(f"{field.upper()} must be at least {min_length} characters")
    return problems


def check_secrets(settings: Settings) -> None:
    """啟動時呼叫：正式環境的密鑰有問題就 raise，服務不啟動。"""
    if problems := secret_problems(settings):
        raise RuntimeError("APP_ENV=production needs real secrets: " + "; ".join(problems))
