from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 執行環境：production 時啟動前檢查密鑰（app/core/production.py），並關掉只給開發用的東西（gRPC reflection、API 文件）。
    app_env: str = "development"

    rabbitmq_host: str = "localhost"
    rabbitmq_port: int = 5672
    rabbitmq_user: str = "admin"
    rabbitmq_password: str = "0000"
    ai_completed_queue: str = "ai.completed"
    job_failed_queue: str = "job.failed"

    http_port: int = 8085


    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


settings = Settings()
