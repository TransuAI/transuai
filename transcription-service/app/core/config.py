from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "admin"
    db_password: str = "0000"
    db_name: str = "transcription_db"

    rabbitmq_host: str = "localhost"
    rabbitmq_port: int = 5672
    rabbitmq_user: str = "admin"
    rabbitmq_password: str = "0000"
    transcription_requested_queue: str = "transcription.requested"
    transcription_completed_queue: str = "transcription.completed"
    job_failed_queue: str = "job.failed"
    transcript_edited_queue: str = "transcript.edited"
    # 由 transcription-service 自己宣告跟擁有，不需要共用 RabbitMQ infra 的 exchange 設定變更，
    # 見 ai-service/docs/adr/0001-message-level-retry-for-transient-external-failures.md。
    retry_queue_2s: str = "transcription.requested.retry.2s"
    retry_queue_4s: str = "transcription.requested.retry.4s"

    storage_endpoint: str = "http://localhost:9000"
    storage_region: str = "us-east-1"
    storage_access_key: str = "admin"
    storage_secret_key: str = "00000000"
    storage_bucket: str = "media-uploads"

    upload_service_grpc_target: str = "localhost:9090"

    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3-turbo"

    grpc_port: int = 8083

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
