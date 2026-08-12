# ai-service

音訊/影片逐字稿 + AI 分析平台的 AI Service。消費 Transcription Service 發出的 `transcription.completed` 事件，取得逐字稿、呼叫 Gemini API 產生摘要，存進自己的 `ai_db`，並回寫 Job 狀態、發送 `ai.completed` 事件。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service)、[`transcription-service`](../transcription-service) 一致）。

## MVP 範圍

對照 [`../architecture-design.md`](../architecture-design.md) 2 / 3.4 / 4.4，AI Service 完整職責包含 embedding、RAG 問答、章節分段、多格式輸出。目前除了「消費事件 → 取逐字稿 → Gemini 摘要 → 回寫狀態 → 發完成事件」這條最短路徑之外，也做了章節分段（同一趟 pipeline 內，用 Gemini 依逐字稿分段的時間戳切章節）。`embeddings` / `qa_history` / `export_outputs` 對應的功能還沒做，`ai_db` 目前只有 `summaries` 和 `chapters` 兩張表。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework |
| API | gRPC（`AiService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費 | RabbitMQ（`pika`），消費 `transcription.completed`，發送 `ai.completed` / `job.failed` |
| 摘要 | Gemini API（`gemini-2.5-flash`），把逐字稿全文丟給模型產生摘要 |
| 章節分段 | 同一個 Gemini model，把逐字稿分段（含時間戳）丟給模型，要求回傳 JSON 章節列表（title + start_time） |
| 取得逐字稿 | gRPC 呼叫 Transcription Service 的 `TranscriptionService.GetTranscript` |
| 資料庫 | PostgreSQL（`ai_db`），SQLAlchemy，MVP 階段用 `create_all` 自動建表 |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務） |

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`
- Upload Service 要跑在 `localhost:9090`（見 [`../upload-service`](../upload-service)），因為要呼叫它的 `InternalJobService.UpdateJobStatus`
- Transcription Service 要跑在 `localhost:8083`（見 [`../transcription-service`](../transcription-service)），因為要呼叫它的 `TranscriptionService.GetTranscript`
- 一組 Gemini API Key（[aistudio.google.com](https://aistudio.google.com/apikey)），填進 `.env` 的 `GEMINI_API_KEY`——沒填的話服務照樣能啟動（health check 正常），但實際消費到訊息、呼叫 Gemini 時會失敗，Job 會被標成 `FAILED`

```bash
cp .env.example .env   # 第一次使用才需要，填入 GEMINI_API_KEY
uv sync
```

## 啟動服務

```bash
uv run python -m app.main
```

啟動時會：

1. 對 `ai_db` 跑 `create_all` 自動建表
2. 開一條背景 thread 消費 RabbitMQ 的 `transcription.completed`（主要業務入口，MQ 驅動）
3. 起 gRPC server，監聽 `8084`

## Pipeline

```
消費 transcription.completed { jobId }
  → UpdateJobStatus(SUMMARIZING)
  → gRPC 呼叫 transcription-service 的 GetTranscript(jobId) 取得逐字稿全文 + 分段
  → 呼叫 Gemini API 產生摘要
  → 呼叫 Gemini API 依分段時間戳切章節（逐字稿沒有分段或模型判斷只有單一主題 → 空章節列表，不算錯誤）
  → 摘要存進 summaries，章節存進 chapters（覆蓋該 job 舊的章節列表）
  → UpdateJobStatus(COMPLETED)
  → 發送 ai.completed { jobId, status }

任一步失敗 → UpdateJobStatus(FAILED, error_reason=<例外訊息>) + 發送 job.failed { jobId, stage: "SUMMARIZING", errorReason }，
訊息照樣 ack（不 requeue），避免永久性失敗（逐字稿不存在、API 額度用盡）造成無窮重試。
章節分段還沒有獨立的 Job status，暫時併在 SUMMARIZING 階段，失敗一樣算整個 job 失敗。
```

## gRPC API

不對外開放，純內部服務對服務呼叫（對應 [`architecture-design.md`](../architecture-design.md) 3.4，原本文件寫的是 REST，這裡改成跟平台其他服務一致的 gRPC）：

`AiService`（`transuai.ai.v1`，見 [`proto/ai.proto`](../infra/proto/ai.proto)）：

| RPC | 說明 |
|---|---|
| `GetSummary` | 依 `job_id` 取得摘要，`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |
| `ListChapters` | 依 `job_id` 取得章節列表（依 `sequence_no` 排序），`job_id` 不合法回 `INVALID_ARGUMENT`；沒有章節時回空列表，不算錯誤 |

不需要 `x-user-id`，跟 upload-service 的 `InternalJobService`、transcription-service 的 `TranscriptionService` 一樣只信任內部網路呼叫。

### 測試方式

跟 upload-service / transcription-service 一樣，用 Postman 開 gRPC 分頁連 `localhost:8084`（plaintext，記得關閉 TLS），靠 reflection 自動列出 method；或用 grpcurl：

```bash
grpcurl -plaintext localhost:8084 list transuai.ai.v1.AiService

grpcurl -plaintext -d '{"jobId":"<job_id>"}' \
  localhost:8084 transuai.ai.v1.AiService/GetSummary
```

## 重新產生 gRPC stub

三份 proto 都要編：`upload.proto`（呼叫 upload-service 的 `InternalJobService`）、`transcription.proto`（呼叫 transcription-service 的 `TranscriptionService`）、`ai.proto`（這個 repo 自己的 API 規格）：

```bash
./scripts/generate_grpc.sh
```

產物在 `app/proto_gen/`，有 commit 進版控，不用每個環境都拉 infra/transcription-service repo 才能跑。

## 專案結構

MVC 風格分層，跟 transcription-service 對照方式一致：

```
app/
  main.py                       建立 gRPC server（AiService + health + reflection）、
                                 lifespan（起 consumer thread、init_db）
  core/
    config.py                    pydantic-settings，讀 .env
  models/
    summary.py                    Summary（SQLAlchemy ORM）
    chapter.py                    Chapter（SQLAlchemy ORM）
  controllers/
    ai_controller.py               AiServiceServicer 實作（GetSummary、ListChapters）
  services/
    consumer.py                      RabbitMQ consumer loop（pika）
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    transcript_client.py               gRPC client，呼叫 transcription-service 的 GetTranscript
    summarizer.py                       Gemini API 呼叫（摘要）
    chapter_generator.py                 Gemini API 呼叫（章節分段）
    gemini_client.py                     共用的 Gemini client（lazy init，摘要/章節分段共用）
    job_status_client.py                 gRPC client，呼叫 upload-service 的 UpdateJobStatus
    event_publisher.py                    發送 ai.completed / job.failed
  repositories/
    summary_repository.py                  ai_db 存取（summaries）
    chapter_repository.py                  ai_db 存取（chapters）
  db/
    session.py                              engine / session / create_all
  proto_gen/                                 gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 已知限制 / 待辦

- Schema 用 SQLAlchemy `create_all` 自動建表，團隊變大或上正式環境前應改用 Alembic 做版本化 migration
- 訊息處理失敗只記錄 `FAILED` + `error_reason`，不做重試/退避；暫時性錯誤（RabbitMQ 抖動、Gemini 429）目前也不會自動重試
- 若 `UpdateJobStatus(FAILED, ...)` 這個回寫本身也失敗（例如 job 在 upload-service 那邊已經不存在），現在會被接住只記 log，不會再讓 consumer thread 掛掉；但這則訊息就此沒有任何後續動作（不會重試、不會有 `job.failed` 事件），只能從 log 找出來手動處理——這是跟 transcription-service 同樣的既有限制
- Embedding（RAG 問答用）、多格式輸出都還沒實作
- 章節分段的 prompt 沒有做輸出格式驗證，Gemini 回傳非預期 JSON（缺欄位、型別不對）時整個 job 會直接標成 `FAILED`，不會重試或降級成「沒有章節」
- Gateway 目前還沒有對應 `ListChapters` 的 REST endpoint（`GET /chapters/{jobId}`），只有 gRPC 這一層
- 沒有測試，目前只靠手動 smoke test
