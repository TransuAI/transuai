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
    transcript_edited_queue: str = "transcript.edited"
    summary_regeneration_requested_queue: str = "summary.regeneration.requested"

    upload_service_grpc_target: str = "localhost:9090"
    transcription_service_grpc_target: str = "localhost:8083"

    hf_api_key: str = ""
    hf_embedding_model: str = "BAAI/bge-m3"
    # 摘要/章節分段/RAG 問答共用同一個 HF Inference Providers 聊天模型，見
    # docs/adr/0003-hf-inference-providers-for-generation.md。
    ai_hf_chat_model: str = "Qwen/Qwen3.5-9B"
    # 生成類呼叫走 HF 的 OpenAI 相容路由（見 app/services/llm_client.py）。
    hf_router_base_url: str = "https://router.huggingface.co/v1"

    # 加密自有金鑰用的主金鑰（AES-256-GCM，base64 編碼的 32 bytes）。沒設定時不能存入自有金鑰，其他功能照常。
    key_encryption_key: str = ""

    grpc_port: int = 8084

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
