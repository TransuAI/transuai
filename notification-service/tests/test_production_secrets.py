"""正式環境（APP_ENV=production）啟動前檢查密鑰（見 .scratch/pre-launch-hardening/issues/07）。"""

import pytest

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.core.production import check_secrets, secret_problems

REAL = "a-long-real-production-secret-0123456789"


def test_the_development_defaults_are_refused_in_production():
    with pytest.raises(RuntimeError) as error:
        check_secrets(Settings(app_env="production", rabbitmq_password="0000",
                               jwt_secret="dev-only-shared-secret-change-me-before-any-real-deployment"))

    for variable in ("RABBITMQ_PASSWORD", "JWT_SECRET"):
        assert variable in str(error.value)


def test_a_short_secret_is_refused_in_production():
    problems = secret_problems(Settings(app_env="production", rabbitmq_password="short-1", jwt_secret="only-20-characters!!"))

    assert problems == ["RABBITMQ_PASSWORD must be at least 12 characters", "JWT_SECRET must be at least 32 characters"]


def test_real_secrets_pass_in_production():
    check_secrets(Settings(app_env="production", rabbitmq_password=REAL, jwt_secret=REAL))


def test_development_is_not_checked():
    assert secret_problems(Settings(app_env="development", rabbitmq_password="0000")) == []


@pytest.mark.parametrize("production, status", [(False, 200), (True, 404)])
def test_the_api_docs_are_only_served_outside_production(production, status):
    client = TestClient(create_app(production))

    assert client.get("/openapi.json").status_code == status
    assert client.get("/docs").status_code == status
