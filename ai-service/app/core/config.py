from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 執行環境：production 時啟動前檢查密鑰（app/core/production.py），並關掉只給開發用的東西（gRPC reflection、API 文件）。
    app_env: str = "development"

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
    quiz_requested_queue: str = "quiz.requested"
    speaker_insights_requested_queue: str = "speaker_insights.requested"
    post_meeting_requested_queue: str = "post_meeting.requested"
    # job.deleted（upload-service 的 fanout exchange）綁到這個服務自己的佇列；處理失敗（例如資料庫連不上）dead-letter 到 retry 佇列，
    # 等 deletion_retry_delay_ms 再回來，不限次數——刪除一定要做完。
    job_deleted_exchange: str = "job.deleted"
    job_deleted_queue: str = "job.deleted.ai"
    job_deleted_retry_queue: str = "job.deleted.ai.retry"
    # account.deleted（auth-service 的 fanout exchange）：使用者刪除了帳號。
    account_deleted_exchange: str = "account.deleted"
    account_deleted_queue: str = "account.deleted.ai"
    account_deleted_retry_queue: str = "account.deleted.ai.retry"
    deletion_retry_delay_ms: int = 30_000

    upload_service_grpc_target: str = "localhost:9090"
    transcription_service_grpc_target: str = "localhost:8083"

    hf_api_key: str = ""
    hf_embedding_model: str = "BAAI/bge-m3"
    # 摘要/章節分段/RAG 問答共用同一個 HF Inference Providers 聊天模型，見
    # docs/adr/0003-hf-inference-providers-for-generation.md。
    ai_hf_chat_model: str = "Qwen/Qwen3.5-9B"
    # 平台模型（摘要、章節、問答、會後處理）走哪個 OpenAI 相容的伺服器（見 app/services/llm_client.py）：預設是 HF 的路由；
    # 本機可以指向 Ollama（例如 http://host.docker.internal:11434/v1），上雲可以指向自架的 vLLM 或其他託管 API。
    platform_llm_base_url: str = "https://router.huggingface.co/v1"
    # 那個伺服器的金鑰；空的就用 HF_API_KEY（預設的 HF 路由用它）。Ollama 不檢查金鑰，隨便填一個即可。
    platform_llm_api_key: str = ""
    # 平台模型每次呼叫多帶的參數（JSON），用來關掉 thinking mode——每種伺服器的寫法不同：HF 的路由與 vLLM 吃 chat template 的
    # 開關（預設值）；Ollama 不吃，要改成 {"reasoning_effort": "none"}。空字串就是不帶。
    platform_llm_extra_body: str = '{"chat_template_kwargs": {"enable_thinking": false}}'
    # 會後處理的平台模型（見 docs/adr/0008）：HF 路由的模型 ID，可以帶「:供應商」後綴，例如 Qwen/Qwen3.8-27B:deepinfra。
    # 空的就是不提供：預設模型是平台模型的使用者不能跑會後處理，要用自有金鑰、支援工具呼叫的模型。
    ai_post_meeting_platform_model: str = ""

    # 加密自有金鑰用的主金鑰（AES-256-GCM，base64 編碼的 32 bytes）。沒設定時不能存入自有金鑰，其他功能照常。
    key_encryption_key: str = ""

    # 平台自己的 Google Cloud OAuth client（連結 Google 帳號用，見 app/services/connections.py）。沒設定時不能連結 Google。
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # 問答「查網路」用的 Tavily 金鑰（平台付費，見 app/services/web_search.py）。沒設定時這個功能關閉，前端不顯示開關。
    tavily_api_key: str = ""

    grpc_port: int = 8084

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


settings = Settings()
