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

    # 聽哪個介面：預設只聽本機（直接在主機上跑、開發時），不會意外對外開放。容器裡要讓別的容器連得到，image 設成 0.0.0.0
    #（見 Dockerfile）；對外只開 edge，隔離靠 compose／k8s 的網路。
    http_host: str = "127.0.0.1"
    http_port: int = 8085

    # 驗證 WebSocket 訂閱者的 access token（auth-service 簽發）。必須跟 auth-service、gateway 的 JWT_SECRET 一樣。
    jwt_secret: str = "dev-only-shared-secret-change-me-before-any-real-deployment"
    # 確認 Job 是這位使用者的：呼叫 upload-service 的 UploadService.GetJob（跟 gateway 一樣，別人的 Job 回 NOT_FOUND）。
    upload_service_grpc_target: str = "localhost:9090"
    upload_service_timeout_seconds: float = 5
    # 連上之後多久內要送出 access token，沒送就關閉連線。
    ws_auth_timeout_seconds: float = 10
    # 同時連線數上限：每位使用者（驗證通過後算）、每個來源 IP（連上就算，包括還沒驗證的）。
    ws_max_connections_per_user: int = 10
    ws_max_connections_per_address: int = 20
    # 來源 IP 看的是直接連進來的位址，不看 X-Forwarded-For（使用者可以自己填）。在反向代理後面時設成代理的位址
    #（逗號分隔，可以用 CIDR），只信這些代理帶的 X-Forwarded-For。空的就一個代理都不信（跟 gateway 的 TRUSTED_PROXIES 一樣）。
    trusted_proxies: str = ""

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


settings = Settings()
