"""正式環境（APP_ENV=production）啟動前檢查密鑰（見 .scratch/pre-launch-hardening/issues/07）。"""

from unittest.mock import patch

import pytest

from app import main
from app.core.config import Settings
from app.core.production import check_secrets, secret_problems

REAL = "a-long-real-production-secret-0123456789"


def test_the_development_defaults_are_refused_in_production():
    with pytest.raises(RuntimeError) as error:
        check_secrets(Settings(app_env="production", db_password="0000", rabbitmq_password="0000", key_encryption_key=""))

    for variable in ("DB_PASSWORD", "RABBITMQ_PASSWORD", "KEY_ENCRYPTION_KEY"):
        assert variable in str(error.value)


def test_a_short_secret_is_refused_in_production():
    problems = secret_problems(Settings(app_env="production", db_password="short-1", rabbitmq_password="a-long-real-production-secret-0123456789", key_encryption_key="a-long-real-production-secret-0123456789"))

    assert problems == ["DB_PASSWORD must be at least 12 characters"]


def test_real_secrets_pass_in_production():
    check_secrets(Settings(app_env="production", db_password=REAL, rabbitmq_password=REAL, key_encryption_key=REAL))


def test_development_is_not_checked():
    assert secret_problems(Settings(app_env="development", db_password="0000", rabbitmq_password="0000", key_encryption_key="")) == []


@pytest.mark.parametrize("app_env, enabled", [("development", True), ("production", False)])
def test_grpc_reflection_is_only_on_outside_production(app_env, enabled):
    with patch.object(main, "settings", Settings(app_env=app_env)), \
            patch.object(main.reflection, "enable_server_reflection") as enable_reflection:
        main.build_server()

    assert enable_reflection.called is enabled
