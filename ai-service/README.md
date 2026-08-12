# ai-service

音訊/影片逐字稿 + AI 分析平台的 AI Service。消費 Transcription Service 發出的 `transcription.completed` 事件，取得逐字稿、呼叫 Groq API 產生摘要，存進自己的 `ai_db`，並回寫 Job 狀態、發送 `ai.completed` 事件。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service)、[`transcription-service`](../transcription-service) 一致）。

## MVP 範圍

對照 [`../architecture-design.md`](../architecture-design.md) 2 / 3.4 / 4.4，AI Service 完整職責包含 embedding、RAG 問答、章節分段、多格式輸出。目前除了「消費事件 → 取逐字稿 → Groq 摘要 → 回寫狀態 → 發完成事件」這條最短路徑之外，也做了章節分段（同一趟 pipeline 內，用 Groq 依逐字稿分段的時間戳切章節）跟 embedding + RAG 問答（pipeline 內把逐字稿分段轉成向量存進 `embeddings`，`AskQuestion` rpc 用 cosine similarity 找最相關片段餵給 Groq 回答，回答連同來源時間戳存進 `qa_history`）。`export_outputs` 對應的功能還沒做，`ai_db` 目前有 `summaries`、`chapters`、`embeddings`、`qa_history` 四張表。

原本摘要/章節分段/RAG 問答/embedding 全部用 Gemini API，開發時常撞到免費層的 429（額度）跟 503（過載）——尤其 embedding 免費層每天只有 100 次請求，測試幾個 job 就用完。改成生成用 Groq（跟 transcription-service 的 Whisper 共用同一把 key，免費層額度寬很多）、embedding 改用 HF Inference API 的開源多語模型，不再依賴 Gemini。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework |
| API | gRPC（`AiService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費 | RabbitMQ（`pika`），消費 `transcription.completed`，發送 `ai.completed` / `job.failed` |
| 摘要 | Groq API（預設 `qwen/qwen3.6-27b`，可用 `AI_GROQ_MODEL` 換模型；跟 transcription-service 的 Whisper 模型設定分開，避免共用 configmap 撞名），把逐字稿全文丟給模型產生摘要 |
| 章節分段 | 同一個 Groq model，把逐字稿分段（含時間戳）丟給模型，要求回傳 JSON 章節列表（title + start_time） |
| Embedding / RAG 問答 | HF Inference API 的 `BAAI/bge-m3`（1024 維，query/document 對稱，不用加任何 instruction 前綴）：pipeline 內把逐字稿分段轉成向量存進 `embeddings`；`AskQuestion` 把問題轉成向量、用 pgvector cosine distance 找最相似的前 5 段，組成 context 餵給 Groq 生成回答 |
| 取得逐字稿 | gRPC 呼叫 Transcription Service 的 `TranscriptionService.GetTranscript` |
| 向量儲存 | PostgreSQL + `pgvector` extension（`Vector(1024)` 欄位，cosine distance 查詢，沒有建 ivfflat 索引——見已知限制） |
| 資料庫 | PostgreSQL（`ai_db`），SQLAlchemy，MVP 階段用 `create_all` 自動建表 |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務） |

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`
- Upload Service 要跑在 `localhost:9090`（見 [`../upload-service`](../upload-service)），因為要呼叫它的 `InternalJobService.UpdateJobStatus`
- Transcription Service 要跑在 `localhost:8083`（見 [`../transcription-service`](../transcription-service)），因為要呼叫它的 `TranscriptionService.GetTranscript`
- 一組 Groq API Key（[console.groq.com/keys](https://console.groq.com/keys)），填進 `.env` 的 `GROQ_API_KEY`（跟 transcription-service 共用同一把也可以）
- 一組 HF Inference API Key（[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)，建立 fine-grained token 時勾選「Make calls to Inference Providers」），填進 `.env` 的 `HF_API_KEY`
- 沒填的話服務照樣能啟動（health check 正常），但實際消費到訊息、呼叫 Groq/HF 時會失敗，Job 會被標成 `FAILED`

```bash
cp .env.example .env   # 第一次使用才需要，填入 GROQ_API_KEY / HF_API_KEY
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
  → 呼叫 Groq API 產生摘要
  → 呼叫 Groq API 依分段時間戳切章節（逐字稿沒有分段或模型判斷只有單一主題 → 空章節列表，不算錯誤）
  → 呼叫 HF Inference API 把逐字稿分段轉成向量
  → 摘要存進 summaries，章節存進 chapters，向量存進 embeddings（都覆蓋該 job 舊的資料）
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
| `AskQuestion` | 針對 `job_id` 的逐字稿內容做 RAG 問答，`job_id`/`user_id` 不合法回 `INVALID_ARGUMENT`；還沒有 embedding（pipeline 沒跑完或該 job 沒有逐字稿分段）回 `NOT_FOUND`；`user_id` 是 Gateway 驗證過 ownership 之後轉過來的，只用來記錄 `qa_history`，不重新驗證 |

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
    embedding.py                  Embedding（SQLAlchemy ORM，pgvector Vector(1024) 欄位）
    qa_history.py                 QaHistory（SQLAlchemy ORM）
  controllers/
    ai_controller.py               AiServiceServicer 實作（GetSummary、ListChapters、AskQuestion）
  services/
    consumer.py                      RabbitMQ consumer loop（pika）
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    transcript_client.py               gRPC client，呼叫 transcription-service 的 GetTranscript
    summarizer.py                       Groq API 呼叫（摘要）
    chapter_generator.py                 Groq API 呼叫（章節分段）
    embedder.py                          HF Inference API 呼叫（embed_documents / embed_query）
    qa.py                                RAG 問答流程：embed 問題 → 向量搜尋 → 組 context 餵 Groq
    groq_client.py                       共用的 Groq client（lazy init）+ strip_thinking()（濾掉 reasoning model 的 <think> 區塊）
    hf_client.py                         共用的 HF InferenceClient（lazy init，embedding 用）
    job_status_client.py                 gRPC client，呼叫 upload-service 的 UpdateJobStatus
    event_publisher.py                    發送 ai.completed / job.failed
  repositories/
    summary_repository.py                  ai_db 存取（summaries）
    chapter_repository.py                  ai_db 存取（chapters）
    embedding_repository.py                ai_db 存取（embeddings，含向量相似度搜尋）
    qa_repository.py                       ai_db 存取（qa_history）
  db/
    session.py                              engine / session / create_all
  proto_gen/                                 gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 已知限制 / 待辦

- Schema 用 SQLAlchemy `create_all` 自動建表，團隊變大或上正式環境前應改用 Alembic 做版本化 migration
- 訊息**處理**失敗（呼叫 Groq/HF 時遇到 429/503 等）只記錄 `FAILED` + `error_reason`，不會重試/退避，一次過載或短暫額度超限就會讓整個 job 直接判定失敗，要重新上傳才能重跑——這點跟 RabbitMQ **連線**層級不一樣：consumer 連線斷線（RabbitMQ 重啟、DNS 暫時解析失敗等）現在有指數退避自動重連（見 `app/services/consumer.py`），不會再讓 consumer thread 永久掛掉
- 若 `UpdateJobStatus(FAILED, ...)` 這個回寫本身也失敗（例如 job 在 upload-service 那邊已經不存在），現在會被接住只記 log，不會再讓 consumer thread 掛掉；但這則訊息就此沒有任何後續動作（不會重試、不會有 `job.failed` 事件），只能從 log 找出來手動處理——這是跟 transcription-service 同樣的既有限制
- 多格式輸出還沒實作
- `embeddings` 沒有建 ivfflat 向量索引：MVP 資料量小、查詢一定先用 `job_id` 過濾縮小範圍，先不做這層優化；資料量大了之後要補
- `qa_history` 目前只寫入沒有查詢 rpc，之後要做「問答歷史」列表可以直接查這張表
- 章節分段的 prompt 沒有做輸出格式驗證，模型回傳非預期 JSON（缺欄位、型別不對）時整個 job 會直接標成 `FAILED`，不會重試或降級成「沒有章節」
- `qwen/qwen3.6-27b` 目前是 Groq 的 preview 模型（官方標註僅供評估用），之後 Groq 下架或改名要記得換 `AI_GROQ_MODEL`
- 換掉 Gemini 之後改用 `BAAI/bge-m3`（1024 維，原本 768 維），`embeddings` 欄位維度也跟著換了；SQLAlchemy `create_all` 不會 ALTER 既有欄位，換維度時整張表要 DROP 掉重建。已存在的 job 要重新跑過 pipeline 才能讓 RAG 問答恢復正常（新舊向量空間本來就不是同一套模型，就算維度沒變也不能直接混用）
- embedding model 選擇受 HF Inference Providers 當下有哪些 provider 實際托管該模型影響很大，會隨時間變動（例如原本想用的 `Qwen/Qwen3-Embedding-0.6B` 開發當下就查無任何 provider 托管）；換 `HF_EMBEDDING_MODEL` 前建議先用 `GET https://huggingface.co/api/models/{model}?expand[]=inferenceProviderMapping` 確認狀態是 `live`
- `qwen/qwen3.6-27b` 回應會把完整 `<think>...</think>` chain-of-thought 混進 `content`（實測 `reasoning_format="hidden"` 參數對這個 preview 模型沒有作用），`groq_client.strip_thinking()` 用 regex 硬濾掉；換其他 Groq 模型時要重新確認是否還需要這層
- 沒有測試，目前只靠手動 smoke test
