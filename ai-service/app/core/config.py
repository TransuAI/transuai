from pydantic import AliasChoices, Field
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
    output_requested_queue: str = "output.requested"
    translation_requested_queue: str = "translation.requested"
    decision_requested_queue: str = "decision.requested"
    fact_check_requested_queue: str = "fact_check.requested"
    claim_check_requested_queue: str = "claim_check.requested"
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

    # 平台模型（摘要、章節、問答、會後處理……）：一台 OpenAI 相容的伺服器——本地自架的 vLLM，或任何相容的託管 API（見
    # docs/adr/0010、0015）。出廠不指向任何服務：沒設定時用平台模型的功能會說「平台模型尚未設定」，使用者可以改用自有金鑰。
    platform_llm_base_url: str = ""
    # 那台伺服器的金鑰；自架的 vLLM 沒開 --api-key 時不用填。
    platform_llm_api_key: str = ""
    # 一般生成用的模型（vLLM 的 served model name）。AI_HF_CHAT_MODEL 是以前的名字，照樣認得。
    platform_llm_model: str = Field("", validation_alias=AliasChoices("PLATFORM_LLM_MODEL", "AI_HF_CHAT_MODEL"))
    # 平台模型每次呼叫多帶的參數（JSON），用來關掉 thinking mode：vLLM 吃 chat template 的開關（預設值）；空字串就是不帶。
    platform_llm_extra_body: str = '{"chat_template_kwargs": {"enable_thinking": false}}'
    # Embedding（問答找相關段落、決策的搜尋）：一台 OpenAI 相容、有 /v1/embeddings 的伺服器（本地 vLLM，見 docs/adr/0015）。
    # 沒設定時不算向量：問答只根據摘要與章節回答，決策只比對字面。換模型之後，啟動時會在背景把既有的向量重算一遍
    # （app/services/embedding_migration.py）。向量欄位是 1024 維：模型要輸出 1024 維（或能用 dimensions 截成 1024）。
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    # 問題（不是逐字稿片段）前面要加的指示：Qwen3-Embedding 這類 instruction-aware 的模型用（加了檢索比較準）；bge-m3 這類
    # 對稱的模型留空。
    embedding_query_instruction: str = ""
    # 會後處理的平台模型（見 docs/adr/0008）：平台模型伺服器上的模型名稱，要能穩定呼叫工具。
    # 空的就是不提供：預設模型是平台模型的使用者不能跑會後處理，要用自有金鑰、支援工具呼叫的模型。
    ai_post_meeting_platform_model: str = ""
    # 每位使用者每個月平台模型的 token 上限（輸入＋輸出）；跟 gateway 的 app.usage-limits.platform-tokens 是同一個環境變數，要一致。
    usage_limit_platform_tokens: int = 2_000_000

    # 加密自有金鑰用的主金鑰（AES-256-GCM，base64 編碼的 32 bytes）。沒設定時不能存入自有金鑰，其他功能照常。
    key_encryption_key: str = ""

    # 平台自己的 Google Cloud OAuth client（連結 Google 帳號用，見 app/services/connections.py）。沒設定時不能連結 Google。
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # 問答「查網路」用的 Tavily 金鑰（平台付費，見 app/services/web_search.py）。沒設定時這個功能關閉，前端不顯示開關。
    tavily_api_key: str = ""

    # 對外連線的允許清單（逗號分隔的網域，見 app/core/outbound.py）；空的就用程式裡的預設清單。平台模型的網域一律自動加進去。
    outbound_allowed_hosts: str = ""

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
