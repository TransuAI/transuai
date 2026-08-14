# transcription-service

音訊/影片逐字稿 + AI 分析平台的 Transcription Service。消費 Upload Service 發出的 `transcription.requested` 事件，抽音軌、呼叫 Groq Whisper API 轉錄、把逐字稿存進自己的 `transcription_db`，並回寫 Job 狀態、發送 `transcription.completed` 事件給下游的 AI Service。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service) 一致）。

## 技術棧

| 項目          | 選擇                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 框架          | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework                                                                                |
| API           | gRPC（`TranscriptionService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費          | RabbitMQ（`pika`），消費 `transcription.requested`，發送 `transcription.completed` / `job.failed`                                                |
| 轉錄          | Groq Whisper API（`whisper-large-v3-turbo`），`verbose_json` 拿分段 timestamp                                                                    |
| 影片抽音軌    | moviepy（底層用 ffmpeg，經 `imageio-ffmpeg` 首次執行時自動下載 binary，本機不需另外安裝系統 ffmpeg）                                             |
| 資料庫        | PostgreSQL（`transcription_db`），SQLAlchemy，MVP 階段用 `create_all` 自動建表                                                                   |
| 物件儲存      | S3 相容 API（`boto3`，本機開發打 MinIO）                                                                                                         |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務）                                                 |

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

Groq Whisper 呼叫遇到暫時性錯誤（429/503 類）且訊息還有重試預算 → 送進 TTL retry queue，過一段
時間後自動送回原 queue 重新處理整個 pipeline（訊息層級 requeue，最多 2 次、共 3 次嘗試，見下方
「已知限制 / 待辦」跟 `app/services/retry.py`）。

其他情況（永久性失敗、或重試預算已用盡）→ UpdateJobStatus(FAILED, error_reason=<例外訊息>) + 發送
job.failed { jobId, stage: "TRANSCRIBING", errorReason }，訊息照樣 ack（不 requeue）。
```

## gRPC API

不對外開放，純內部服務對服務呼叫（對應 [`architecture-design.md`](../architecture-design.md) 3.3，原本文件寫的是 REST，這裡改成跟平台其他服務一致的 gRPC）：

`TranscriptionService`（`transuai.transcription.v1`，見 [`proto/transcription.proto`](proto/transcription.proto)）：

| RPC             | 說明                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `GetTranscript` | 依 `job_id` 取得逐字稿全文 + 分段 timestamp，`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |

不需要 `x-user-id`，跟 upload-service 的 `InternalJobService` 一樣只信任內部網路呼叫。

### 測試方式

跟 upload-service 一樣，用 Postman 開 gRPC 分頁連 `localhost:8083`（plaintext，記得關閉 TLS），靠 reflection 自動列出 method；或用 grpcurl：

```bash
grpcurl -plaintext localhost:8083 list transuai.transcription.v1.TranscriptionService

grpcurl -plaintext -d '{"jobId":"<job_id>"}' \
  localhost:8083 transuai.transcription.v1.TranscriptionService/GetTranscript
```

## 測試

```bash
uv run pytest
```

用 pytest，mocking 只用標準庫的 `unittest.mock`。測試不需要跑起 `infra`（Postgres/RabbitMQ/MinIO）
或填任何 API key——`tests/test_pipeline_retry.py` 把 pipeline 會碰到的所有外部 I/O（Groq、下載、
gRPC 狀態回報、DB session）都 mock 掉，直接驗證 `process_message()` 這個 seam 本身的邏輯；
`tests/test_retry.py` 直接測 Groq 例外分類跟 retry queue 路由這兩個純函式/邏輯，不碰真正的
RabbitMQ/pika。

Mock 一定要 patch 在 `app/services/pipeline.py`「使用端」import 進來的名稱（例如
`pipeline.transcribe`、`pipeline.job_status_client`），不是「定義端」的原始模組——`unittest.mock.patch`
只替換掉 name binding，patch 定義端不會影響 pipeline.py 實際呼叫到的是誰（跟 `ai-service` 同一個
坑，見 `ai-service/README.md` 測試一節）。

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
  main.py                       建立 gRPC server（TranscriptionService + health + reflection）、lifespan（起 consumer thread、init_db）
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
    event_publisher.py                     發送 transcription.completed / job.failed
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
- `transcribe()` 呼叫 Groq Whisper 遇到暫時性錯誤（429 rate limit、503 過載類）會自動重試（訊息層級 requeue，最多 2 次、共 3 次嘗試，機制跟 `ai-service` 完全一樣，見 `app/services/retry.py` 跟 `ai-service/docs/adr/0001-...md`）；永久性失敗（壞檔、額度用盡等）或重試預算用盡才會直接判定 `FAILED`，要重新上傳才能重跑。`download_object`/`extract_audio_track`/DB 寫入/gRPC 狀態回報這幾步目前還不在這個重試機制涵蓋範圍內，任一步失敗一樣立即判定失敗（這點跟 RabbitMQ **連線**層級不一樣：consumer 連線斷線時已經有指數退避自動重連，見 `app/services/consumer.py`）
- 若 `UpdateJobStatus(FAILED, ...)` 這個回寫本身也失敗（例如 job 在 upload-service 那邊已經不存在），現在會被接住只記 log，不會再讓 consumer thread 掛掉；但這則訊息就此沒有任何後續動作（不會重試、不會有 `job.failed` 事件），只能從 log 找出來手動處理——`ai-service` 已經幫這一段補上獨立的 in-process 重試 + 高嚴重度 log marker，這裡還沒跟進，是目前真實存在的已知限制
- 講者分離（`speaker_label`）欄位已預留但未實作
- 測試覆蓋率目前很低，只有 pipeline seam 跟 retry 分類/路由這兩塊（見上方「測試」一節）；`storage`/`audio`/`transcriber` 等模組本身、gRPC controller 層都還只靠手動 smoke test
