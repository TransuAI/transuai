from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "admin"
    db_password: str = "0000"
    db_name: str = "ai_db"

    rabbitmq_host: str = "localhost"
    rabbitmq_port: int = 5672
    rabbitmq_user: str = "admin"
    rabbitmq_password: str = "0000"
    transcription_completed_queue: str = "transcription.completed"
    ai_completed_queue: str = "ai.completed"
    job_failed_queue: str = "job.failed"
    # 由 ai-service 自己宣告跟擁有，不需要共用 RabbitMQ infra 的 exchange 設定變更，見 ADR 0001。
    retry_queue_2s: str = "transcription.completed.retry.2s"
    retry_queue_4s: str = "transcription.completed.retry.4s"

    upload_service_grpc_target: str = "localhost:9090"
    transcription_service_grpc_target: str = "localhost:8083"

    groq_api_key: str = ""
    # 欄位刻意不叫 groq_model：transcription-service 也有一個 GROQ_MODEL（whisper 模型），
    # 兩個服務共用同一份 configmap，撞名會讓這裡讀到 whisper 的型號字串。
    ai_groq_model: str = "qwen/qwen3.6-27b"

    hf_api_key: str = ""
    hf_embedding_model: str = "BAAI/bge-m3"

    grpc_port: int = 8084

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
