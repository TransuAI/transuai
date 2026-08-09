# transcription-service

音訊/影片逐字稿 + AI 分析平台的 Transcription Service。消費 Upload Service 發出的 `transcription.requested` 事件，抽音軌、呼叫 Groq Whisper API 轉錄、把逐字稿存進自己的 `transcription_db`，並回寫 Job 狀態、發送 `transcription.completed` 事件給下游的 AI Service。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service) 一致）。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework |
| API | gRPC（`TranscriptionService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費 | RabbitMQ（`pika`），消費 `transcription.requested`，發送 `transcription.completed` |
| 轉錄 | Groq Whisper API（`whisper-large-v3-turbo`），`verbose_json` 拿分段 timestamp |
| 影片抽音軌 | moviepy（底層用 ffmpeg，經 `imageio-ffmpeg` 首次執行時自動下載 binary，本機不需另外安裝系統 ffmpeg） |
| 資料庫 | PostgreSQL（`transcription_db`），SQLAlchemy，MVP 階段用 `create_all` 自動建表 |
| 物件儲存 | S3 相容 API（`boto3`，本機開發打 MinIO） |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務） |

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`
- Upload Service 要跑在 `localhost:9090`（見 [`../upload-service`](../upload-service)），因為要呼叫它的 `InternalJobService.UpdateJobStatus`
- 一組 Groq API Key（[console.groq.com](https://console.groq.com)），填進 `.env` 的 `GROQ_API_KEY`

```bash
cp .env.example .env   # 第一次使用才需要，填入 GROQ_API_KEY
uv sync
```

## 啟動服務

```bash
uv run python -m app.main
```

啟動時會：

1. 對 `transcription_db` 跑 `create_all` 自動建表
2. 開一條背景 thread 消費 RabbitMQ 的 `transcription.requested`（主要業務入口，MQ 驅動）
3. 起 gRPC server，監聽 `8083`

## Pipeline

```
消費 transcription.requested { jobId, storagePath, fileType }
  → UpdateJobStatus(TRANSCRIBING)
  → 從物件儲存下載檔案
  → file_type == VIDEO 才用 moviepy 抽音軌，AUDIO 直接用原始檔案
  → 呼叫 Groq Whisper API（verbose_json，含分段 timestamp）
  → 逐字稿存進 transcripts / transcript_segments
  → UpdateJobStatus(TRANSCRIBED)
  → 發送 transcription.completed { jobId }

任一步失敗 → UpdateJobStatus(FAILED, error_reason=<例外訊息>)，訊息照樣 ack（不 requeue），
避免永久性失敗（壞檔、API 額度用盡）造成無窮重試。
```

## gRPC API

不對外開放，純內部服務對服務呼叫（對應 [`architecture-design.md`](../architecture-design.md) 3.3，原本文件寫的是 REST，這裡改成跟平台其他服務一致的 gRPC）：

`TranscriptionService`（`transuai.transcription.v1`，見 [`proto/transcription.proto`](proto/transcription.proto)）：

| RPC | 說明 |
|---|---|
| `GetTranscript` | 依 `job_id` 取得逐字稿全文 + 分段 timestamp，`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |

不需要 `x-user-id`，跟 upload-service 的 `InternalJobService` 一樣只信任內部網路呼叫。

### 測試方式

跟 upload-service 一樣，用 Postman 開 gRPC 分頁連 `localhost:8083`（plaintext，記得關閉 TLS），靠 reflection 自動列出 method；或用 grpcurl：

```bash
grpcurl -plaintext localhost:8083 list transuai.transcription.v1.TranscriptionService

grpcurl -plaintext -d '{"jobId":"<job_id>"}' \
  localhost:8083 transuai.transcription.v1.TranscriptionService/GetTranscript
```

## 重新產生 gRPC stub

兩份 proto 都要編：`upload.proto`（在 `../upload-service/src/main/proto/upload.proto`，呼叫它的 `InternalJobService`）跟 `proto/transcription.proto`（這個 repo 自己的 API 規格）：

```bash
./scripts/generate_grpc.sh
```

產物在 `app/proto_gen/`，有 commit 進版控，不用每個環境都拉 upload-service repo 才能跑。

## 專案結構

MVC 風格分層，對照方式：`models` = Model，`controllers` = Controller（這裡是 gRPC servicer，不是 REST route），業務邏輯（pipeline、外部服務呼叫）另外拆到 `services`，DB 存取拆到 `repositories`——這兩層是常見的延伸，純 MVC 沒有明確對應位置。gRPC 用 proto message 本身當輸入/輸出格式，不需要另外的 `schemas` 序列化層。

```
app/
  main.py                       建立 gRPC server（TranscriptionService + health + reflection）、
                                 lifespan（起 consumer thread、init_db）
  core/
    config.py                    pydantic-settings，讀 .env
  models/
    transcript.py                 Transcript / TranscriptSegment（SQLAlchemy ORM）
  controllers/
    transcript_controller.py       TranscriptionServiceServicer 實作（GetTranscript）
  services/
    consumer.py                      RabbitMQ consumer loop（pika）
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    storage.py                         從 MinIO/R2 下載檔案
    audio.py                            moviepy 抽音軌
    transcriber.py                       Groq Whisper API 呼叫
    job_status_client.py                  gRPC client，呼叫 Upload Service 的 UpdateJobStatus
    event_publisher.py                     發送 transcription.completed
  repositories/
    transcript_repository.py               transcription_db 存取（transcripts / transcript_segments）
  db/
    session.py                               engine / session / create_all
  proto_gen/                                  gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
proto/transcription.proto                   這個服務自己的 API 規格（唯一來源）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 已知限制 / 待辦

- Schema 用 SQLAlchemy `create_all` 自動建表，團隊變大或上正式環境前應改用 Alembic 做版本化 migration
- 訊息處理失敗只記錄 `FAILED` + `error_reason`，不做重試/退避；暫時性錯誤（RabbitMQ 抖動、Groq 429）目前也不會自動重試
- 講者分離（`speaker_label`）欄位已預留但未實作
- 沒有測試（upload-service 有 `UploadGrpcServiceIT` 這類整合測試，這裡目前只靠手動 smoke test）
