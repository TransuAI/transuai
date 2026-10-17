from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 執行環境：production 時啟動前檢查密鑰（app/core/production.py），並關掉只給開發用的東西（gRPC reflection、API 文件）。
    app_env: str = "development"

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
    # job.deleted（upload-service 的 fanout exchange）綁到這個服務自己的佇列；處理失敗（例如資料庫連不上）dead-letter 到 retry 佇列，
    # 等 deletion_retry_delay_ms 再回來，不限次數——刪除一定要做完。
    job_deleted_exchange: str = "job.deleted"
    job_deleted_queue: str = "job.deleted.transcription"
    job_deleted_retry_queue: str = "job.deleted.transcription.retry"
    # account.deleted（auth-service 的 fanout exchange）：使用者刪除了帳號。
    account_deleted_exchange: str = "account.deleted"
    account_deleted_queue: str = "account.deleted.transcription"
    account_deleted_retry_queue: str = "account.deleted.transcription.retry"
    deletion_retry_delay_ms: int = 30_000
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

    # 逐字稿的快取（cache-aside，見 app/services/transcript_cache.py）。Redis 連不上時照樣讀資料庫。
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    redis_timeout_seconds: float = 0.5
    transcript_cache_ttl_seconds: int = 600

    # 送去語音辨識之前用實際長度檢查（見 services/recording_limits.py）。每月上限要跟 gateway 的 USAGE_LIMIT_TRANSCRIPTION_MINUTES 一樣。
    max_recording_minutes: int = 60
    usage_limit_transcription_minutes: int = 600

    # 對外連線的允許清單（逗號分隔的網域，見 app/core/outbound.py）；空的就只有 Deepgram。本地語音辨識伺服器的網域自動加入。
    outbound_allowed_hosts: str = ""

    # 語音辨識跑在哪裡（見 docs/adr/0003）。出廠什麼都不設：
    # - 本地：STT_BASE_URL 指向 OpenAI 相容的 /v1/audio/transcriptions（自架的 vLLM 跑 Breeze-ASR-25），講者分離在這個服務裡用
    #   CPU 跑（sherpa-onnx，模型打包在 image 裡）。有設定就用它。
    # - Deepgram（雲端）：沒設本地、有 DEEPGRAM_API_KEY 時用它，轉錄與講者分離一次完成。
    # 兩個都沒設時轉錄會說「語音辨識尚未設定」。
    stt_base_url: str = ""
    stt_api_key: str = ""
    stt_model: str = ""
    # 講者分離的模型目錄（pyannote segmentation-3.0 的 ONNX 與 3D-Speaker 的 CAM++，Dockerfile 下載進 image）；沒有模型就不分講者。
    diarization_models_dir: str = "/app/models/diarization"
    # 兩段聲音的講者向量相似到什麼程度算同一個人（越大分出越少人）；用 CPU 的執行緒數。
    diarization_threshold: float = 0.6
    diarization_threads: int = 4

    # 系統設定頁存的金鑰（本地語音辨識、Deepgram）用這把加密（AES-256-GCM，base64 的 32 bytes，跟 ai-service 的同一把）；沒設定時不能
    # 在設定頁存金鑰。
    key_encryption_key: str = ""

    deepgram_api_key: str = ""
    deepgram_model: str = "nova-3"
    # 固定指定語言而不是讓 Deepgram 自動偵測：自動偵測的中文走的是通用模型，輸出簡體、錯字也明顯較多（見 ADR 0001）。
    deepgram_language: str = "zh-TW"

    grpc_port: int = 8083

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
