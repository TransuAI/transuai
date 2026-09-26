# ai-service

音訊/影片逐字稿 + AI 分析平台的 AI Service。消費 Transcription Service 發出的 `transcription.completed` 事件，取得逐字稿、呼叫 HF Inference Providers 產生摘要，存進自己的 `ai_db`，並回寫 Job 狀態、發送 `ai.completed` 事件。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service)、[`transcription-service`](../transcription-service) 一致）。

## MVP 範圍

對照 [`../architecture-design.md`](../architecture-design.md) 2 / 3.4 / 4.4，AI Service 完整職責包含 embedding、RAG 問答、章節分段、多格式輸出。目前除了「消費事件 → 取逐字稿 → 產生摘要 → 回寫狀態 → 發完成事件」這條最短路徑之外，也做了章節分段（同一趟 pipeline 內，依逐字稿分段的時間戳切章節）跟 embedding + RAG 問答（pipeline 內把逐字稿分段轉成向量存進 `embeddings`；`AskQuestion` rpc 用 cosine similarity 找最相關片段，連同最近幾輪對話歷史一起餵給 LLM，以 server-streaming 方式即時回傳答案，成功後才連同來源時間戳存進 `qa_history`；`ListQaHistory` rpc 讀回一個 job 的完整問答紀錄）。「對話」的範圍見 [`CONTEXT.md`](./CONTEXT.md) 跟 [`docs/adr/0002-single-conversation-per-job.md`](./docs/adr/0002-single-conversation-per-job.md)。`export_outputs` 對應的功能還沒做，`ai_db` 目前有 `summaries`、`chapters`、`embeddings`、`qa_history` 四張表。

原本摘要/章節分段/RAG 問答/embedding 全部用 Gemini API，開發時常撞到免費層的 429（額度）跟 503（過載）——尤其 embedding 免費層每天只有 100 次請求，測試幾個 job 就用完。第一次改版把生成類呼叫換成 Groq、embedding 換成 HF Inference API；後來 Groq 的 `qwen/qwen3.6-27b` 免費層 TPM 太小（8000 tokens/min），加上對話記憶之後很容易撞到 `413 Request too large`，第二次改版把生成類呼叫也一併換到 HF Inference Providers（`Qwen/Qwen3.5-9B`），現在摘要/章節分段/RAG 問答/embedding 全部走同一個 HF 帳號、同一支 `hf_client.py`。取捨見 [`docs/adr/0003-hf-inference-providers-for-generation.md`](./docs/adr/0003-hf-inference-providers-for-generation.md)。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework |
| API | gRPC（`AiService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費 | RabbitMQ（`pika`），消費 `transcription.completed`，發送 `ai.completed` / `job.failed` |
| 摘要 | HF Inference Providers（預設 `Qwen/Qwen3.5-9B`，可用 `AI_HF_CHAT_MODEL` 換模型），把逐字稿全文丟給模型產生摘要；兩位以上講者時改成每行「名稱：文字」（見下方「講者」） |
| 章節分段 | 同一個 HF 聊天模型，把逐字稿片段（含時間戳，兩位以上講者時每行 `[開始時間] 名稱：文字`）丟給模型，要求回傳 JSON 章節列表（title + start_time） |
| Embedding | HF Inference Providers 的 `BAAI/bge-m3`（1024 維，query/document 對稱，不用加任何 instruction 前綴）：pipeline 內把逐字稿分段轉成向量存進 `embeddings` |
| RAG 問答 | `AskQuestion` 把問題（有對話歷史時先用同一個 HF 聊天模型做語意判斷 + 條件式改寫，見 `CONTEXT.md`「改寫後的問題」）轉成向量、用 pgvector cosine distance 找最相似的前 5 段，組成 context 連同最近 5 輪對話歷史一起餵給模型，用 `stream=True` 逐字串流生成回答；兩位以上講者時 context 每行帶講者**目前的**名稱（回答當下呼叫 `GetTranscript` 取得） |
| 取得逐字稿 | gRPC 呼叫 Transcription Service 的 `TranscriptionService.GetTranscript` |
| 向量儲存 | PostgreSQL + `pgvector` extension（`Vector(1024)` 欄位，cosine distance 查詢，沒有建 ivfflat 索引——見已知限制） |
| 資料庫 | PostgreSQL（`ai_db`），SQLAlchemy；schema 用 Alembic 版本化 migration（`app/db/migrations`），服務啟動時自動升級 |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務） |

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`
- Upload Service 要跑在 `localhost:9090`（見 [`../upload-service`](../upload-service)），因為要呼叫它的 `InternalJobService.UpdateJobStatus`
- Transcription Service 要跑在 `localhost:8083`（見 [`../transcription-service`](../transcription-service)），因為要呼叫它的 `TranscriptionService.GetTranscript`
- 一組 HF Inference API Key（[huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)，建立 fine-grained token 時勾選「Make calls to Inference Providers」），填進 `.env` 的 `HF_API_KEY`——embedding 跟摘要/章節分段/RAG 問答共用同一把
- 沒填的話服務照樣能啟動（health check 正常），但實際消費到訊息、呼叫 HF 時會失敗，Job 會被標成 `FAILED`

```bash
cp .env.example .env   # 第一次使用才需要，填入 HF_API_KEY
uv sync
```

## 啟動服務

```bash
uv run python -m app.main
```

啟動時會：

1. 把 `ai_db` 的 schema 升級到最新的 Alembic migration（多個副本同時啟動時用 Postgres advisory lock 排隊）。導入 Alembic 前用 `create_all` 建的資料庫可能只有部分表（例如只有 `summaries`），baseline（`0001`）只補建缺少的表、不動既有的表跟資料，不需要刪庫重建；唯一例外是還停在 768 維的舊 `embeddings` 表，會拒絕啟動並提示整張表 DROP 掉、重跑 pipeline
2. 開一條背景 thread 消費 RabbitMQ 的 `transcription.completed`（主要業務入口，MQ 驅動）、`transcript.edited`（使用者編輯逐字稿後，更新問答用的 embedding）跟 `summary.regeneration.requested`（使用者要求重新產生摘要與章節）
3. 起 gRPC server，監聽 `8084`

## Pipeline

```
消費 transcription.completed { jobId }
  → UpdateJobStatus(SUMMARIZING)
  → gRPC 呼叫 transcription-service 的 GetTranscript(jobId) 取得逐字稿全文 + 分段
  → 已清空片段（空字串）不算內容，從下面每個 AI 輸入排除
  → 呼叫 HF Inference Providers 產生摘要（兩位以上講者時輸入是每行「名稱：文字」，否則是逐字稿全文）
  → 呼叫 HF Inference Providers 依片段時間戳切章節（兩位以上講者時每行 `[開始時間] 名稱：文字`）（逐字稿沒有片段或模型判斷只有單一主題 → 空章節列表，不算錯誤）
  → 呼叫 HF Inference Providers 把逐字稿分段轉成向量
  → 摘要（連同讀到的逐字稿 revision，記成 source_revision）存進 summaries，章節存進 chapters，向量存進 embeddings（都覆蓋該 job 舊的資料）
  → UpdateJobStatus(COMPLETED)
  → 發送 ai.completed { jobId, status }

任一步失敗，先判斷是不是暫時性失敗（HF SDK 例外型別、gRPC status code，見
app/services/retry.py）且訊息還有重試預算（最多重試 2 次，共 3 次嘗試）：
  - 是 → 把訊息送進對應 TTL 的 retry queue（`transcription.completed.retry.2s`／`.4s`），原始那份直接 ack，過一段時間後訊息
    透過 dead-letter-exchange 自動送回原 queue，被當成全新訊息重新處理一次完整的 pipeline
    （見 docs/adr/0001-message-level-retry-for-transient-external-failures.md）。整個過程
    對使用者不可見，Job 狀態維持在處理中。
  - 否（永久性失敗，或重試預算已用盡）→ UpdateJobStatus(FAILED, error_reason=<例外訊息>) +
    發送 job.failed { jobId, stage: "SUMMARIZING", errorReason }，訊息照樣 ack（不 requeue）。
    這個回報動作本身如果因為暫時性 gRPC 錯誤失敗，會用一個小型、快速的 in-process 重試（3 次
    嘗試、200ms 起跳倍增、封頂 800ms）；仍然失敗的話記錄一則高嚴重度、好搜尋的 log
    （AI_SERVICE_TERMINAL_FAILURE_REPORT_LOST），不會再讓 consumer thread 掛掉。

章節分段還沒有獨立的 Job status，暫時併在 SUMMARIZING 階段，失敗一樣算整個 job 失敗。
```

### 講者

逐字稿有兩位以上講者（有內容的片段裡出現的講者，見 transcription-service `CONTEXT.md`「講者」）時，AI 的輸入帶上講者的
**顯示名稱**：摘要每行「名稱：文字」、章節每行 `[開始時間] 名稱：文字`，prompt 要求點出誰說了什麼。問答的 embedding
**只依片段文字**（名字會改，改名不能讓 embedding 過期）；回答當下才呼叫 `GetTranscript` 拿最新的片段與講者，用起訖時間把
檢索到的片段對回逐字稿、換上講者目前的名字，prompt 要求用這些名字稱呼講者——改名後下一次提問就是新名字，什麼都不用重算。
拿不到逐字稿（失敗或超過 2 秒）時照樣回答，只是不帶名字。只有一位講者或講者分離之前的舊逐字稿，輸入維持原樣、不帶名字。

### 重新產生摘要與章節（`summary.regeneration.requested`）

```
RequestRegeneration(jobId)（Gateway POST /summary/{jobId}/regenerate）
  → 鎖住該 job 的摘要列；已經 RUNNING 且在 5 分鐘內 → 什麼都不做
  → regeneration_status = RUNNING、排入 summary.regeneration.requested { jobId }（publisher confirms、短 timeout；失敗則 rollback）
消費 summary.regeneration.requested { jobId }
  → GetTranscript（revision R）→ 排除已清空片段、帶上講者目前的名稱（同 pipeline）→ 摘要 + 章節都成功後才覆寫兩者
  → source_revision = R、regeneration_status = IDLE
```

暫時性失敗走訊息層級重試（`summary.regeneration.requested.retry.2s`／`.4s`）；最終失敗 → `regeneration_status = FAILED`，
舊內容保留（摘要在原本那一列上更新、跟章節同一個 transaction 寫入，不會只換掉一半）。RUNNING 超過 5 分鐘視為卡住（例如服務中途重啟），
`GetSummary` 對外回報成 FAILED，使用者看得到重試按鈕。全程不動 Job 狀態、不發 `ai.completed`／`job.failed`（工作區只在 COMPLETED 時顯示）。重新產生期間又被編輯的話，
source_revision 是讀到的 R，前端照樣會顯示過時。

### 逐字稿被編輯之後（`transcript.edited`）

```
消費 transcript.edited { jobId }（見根目錄 docs/adr/0003）
  → gRPC GetTranscript(jobId) 取最新的片段
  → 以片段的起訖時間（NUMERIC(10,2)）對應這個 job 現有的 embedding：
      文字變了 → 重算；被清空（空字串）→ 刪掉；從清空還原（沒有對應的列）→ 算一筆新的；都沒變 → 不呼叫 embedder
  → 只寫入 / 刪除有變的那幾列
```

暫時性失敗一樣走訊息層級重試（`transcript.edited.retry.2s`／`.4s`）。預算用盡或永久性失敗只記 log——這不是 Job
的 pipeline，不回寫 Job 狀態、不發 `job.failed`，問答的檢索資料就先維持舊的，等下一次編輯。存檔到 embedding 更新之間
有約一秒的空窗，這段時間問答可能還用到舊文字（ADR 0003 刻意接受）。

## gRPC API

不對外開放，純內部服務對服務呼叫（對應 [`architecture-design.md`](../architecture-design.md) 3.4，原本文件寫的是 REST，這裡改成跟平台其他服務一致的 gRPC）：

`AiService`（`transuai.ai.v1`，見 [`proto/ai.proto`](../infra/proto/ai.proto)）：

| RPC | 說明 |
|---|---|
| `RequestRegeneration` | 摘要與章節過時後要求重新產生：狀態設 RUNNING、排入 `summary.regeneration.requested` 後立即回傳目前的摘要；已在跑（5 分鐘內）不重複排入；沒有摘要回 `NOT_FOUND`，排入失敗回 `UNAVAILABLE`（狀態不變） |
| `GetSummary` | 依 `job_id` 取得摘要、`source_revision`（依據的逐字稿 revision；小於逐字稿目前的 revision 就是過時）與 `regeneration_status`，`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |
| `ListChapters` | 依 `job_id` 取得章節列表（依 `sequence_no` 排序），`job_id` 不合法回 `INVALID_ARGUMENT`；沒有章節時回空列表，不算錯誤 |
| `AskQuestion` | 針對 `job_id` 的逐字稿內容做 RAG 問答（含最近 5 輪對話記憶），**server-streaming**：回傳 `stream AskQuestionChunk`（`oneof`: `sources` 恰好一次、任意數量 `delta`、失敗時恰好一次 `error`）。`job_id`/`user_id` 不合法回 `INVALID_ARGUMENT`；還沒有 embedding（pipeline 沒跑完或該 job 沒有逐字稿分段）回 `NOT_FOUND`，這種情況一定發生在任何 chunk 送出之前；改寫/生成中途失敗改用 `error` chunk（stream 正常結束，不寫 `qa_history`），不是 gRPC 層級的錯誤。`user_id` 是 Gateway 驗證過 ownership 之後轉過來的，只用來記錄 `qa_history`，不重新驗證 |
| `ListQaHistory` | 依 `job_id` 取得這個 job 的完整問答紀錄（依 `created_at` 升冪），`job_id` 不合法回 `INVALID_ARGUMENT`；沒有紀錄回空列表，不算錯誤；不分頁（MVP 資料量小） |

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

## 資料庫 migration

新增或修改 model 之後，產生一支新的 migration、檢查內容，再重新啟動服務（啟動時自動升級）：

```bash
uv run alembic revision --autogenerate --rev-id 0002 -m "describe the change"   # 版本號接續上一支，檔名才會依序排
uv run alembic check   # models 跟 migration 沒有差異時會回 No new upgrade operations detected
```

`alembic.ini` 只給 CLI 用，資料庫連線一律來自 `app/core/config.py` 的設定（環境變數 / `.env`）。

## 測試

```bash
uv run pytest
```

用 pytest，mocking 只用標準庫的 `unittest.mock`（沒有額外裝 `pytest-mock`）。

碰資料庫的測試——migration（`tests/test_db_migrations.py`）、逐字稿編輯後重算 embedding（`tests/test_reembed.py`，只 mock gRPC client 跟 HF embedder）、in-process 的 gRPC 服務（`tests/test_ai_grpc.py`）——是對**真的 Postgres** 測：需要先 `cd ../infra && docker compose up -d`，
`tests/conftest.py` 會在同一個 Postgres 上建（或清空重建）一個獨立的 `ai_test_db`，絕對不會碰到 `ai_db`。

其餘測試不需要跑起 `infra`（Postgres/RabbitMQ）或填任何 API key——`tests/test_pipeline.py` 把 pipeline 會碰到的所有外部 I/O（HF、呼叫 upload-service/transcription-service 的 gRPC client、資料庫 session）都 mock 掉，直接驗證 `process_message()` 這個 seam 本身的邏輯（呼叫順序、傳入/存入的資料）。

Mock 一定要 patch 在 `app/services/pipeline.py`「使用端」import 進來的名稱（例如 `pipeline.summarize`、`pipeline.job_status_client`），不是「定義端」的原始模組（例如 `app.services.summarizer.summarize`）——`unittest.mock.patch` 只替換掉 name binding，patch 定義端不會影響 pipeline.py 實際呼叫到的是誰。

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
    ai_controller.py               AiServiceServicer 實作（GetSummary、ListChapters、AskQuestion、ListQaHistory、RequestRegeneration）
  services/
    reembed.py                       消費 transcript.edited：只重算文字有變的片段的 embedding
    regeneration.py                  RequestRegeneration（排入自己的 queue）與消費 summary.regeneration.requested：重新產生摘要與章節
    consumer.py                      RabbitMQ consumer loop（pika）：「queue → 處理函式」對照表，每個被消費的 queue 各自宣告一組 `<queue>.retry.2s`／`.4s`，重試回到同一個處理函式
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    transcript_client.py               gRPC client，呼叫 transcription-service 的 GetTranscript
    summarizer.py                       HF Inference Providers 呼叫（摘要）
    chapter_generator.py                 HF Inference Providers 呼叫（章節分段）
    embedder.py                          HF Inference Providers 呼叫（embed_documents / embed_query）
    qa.py                                RAG 問答（含對話記憶）：條件式改寫問題 → 向量搜尋 → 組 context（多位講者時帶講者目前的名稱）+ 對話歷史 → streaming 生成回答
    speaker_context.py                   讓 AI 知道講者是誰：兩位以上講者時把片段組成「名稱：文字」（摘要）、`[時間] 名稱：文字`（章節），以及問答用的「片段起訖時間 → 講者目前的名字」；只有一位講者或舊逐字稿時維持原樣
    segment_times.py                     片段起訖時間的對應鍵（embedding 對回逐字稿片段用，重算 embedding 與問答共用）
    hf_client.py                         共用的 HF InferenceClient（lazy init，embedding + chat completion 共用同一個 client）+ DISABLE_THINKING（關閉 Qwen3 系列的 thinking mode，所有 chat completion 呼叫都要帶）+ strip_thinking()／stream_without_thinking()（防禦性濾掉 <think> 區塊，正常情況下是 no-op，後者是 streaming 版）
    job_status_client.py                 gRPC client，呼叫 upload-service 的 UpdateJobStatus
    event_publisher.py                    發送 ai.completed / job.failed / summary.regeneration.requested；connection_params() 供 consumer 與 gRPC 請求內發訊息共用
  repositories/
    summary_repository.py                  ai_db 存取（summaries）
    chapter_repository.py                  ai_db 存取（chapters）
    embedding_repository.py                ai_db 存取（embeddings，含向量相似度搜尋）
    qa_repository.py                       ai_db 存取（qa_history）
  db/
    session.py                              engine / session / init_db（Alembic upgrade）
    migrations/                             Alembic migration（`versions/0001_baseline.py` 是導入前 create_all 建出的 schema，只補建缺少的表）
  proto_gen/                                 gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 已知限制 / 待辦

- 訊息處理遇到暫時性失敗（HF 429/503、內部 gRPC 服務短暫不可用）會自動重試（訊息層級 requeue，
  最多 2 次、共 3 次嘗試，見上面 Pipeline 一節跟 `docs/adr/0001-...md`）；重試預算用盡、或失敗屬於永久性
  （格式錯誤、認證失敗、job 真的不存在）才會直接判定 `FAILED`，要重新上傳才能重跑
- 若 `UpdateJobStatus(FAILED, ...)` 這個回寫本身也失敗，會先做一次獨立、快速的 in-process 重試；只有連
  這個重試都用盡（或失敗屬於永久性，例如 job 在 upload-service 那邊已經不存在）才會放棄，此時這則訊息
  沒有任何後續動作（不會有 `job.failed` 事件），但會記錄一則高嚴重度、帶 `AI_SERVICE_TERMINAL_FAILURE_REPORT_LOST`
  marker 的 log，方便跟一般 log 區分、手動搜尋處理——沒有額外的 dead-letter queue 或事件記錄這類遺失的回報，
  這是目前接受的已知限制，之後若證明是實際的維運痛點再處理
- 多格式輸出還沒實作
- `embeddings` 沒有建 ivfflat 向量索引：MVP 資料量小、查詢一定先用 `job_id` 過濾縮小範圍，先不做這層優化；資料量大了之後要補
- 章節分段的 prompt 沒有做輸出格式驗證，模型回傳非預期 JSON（缺欄位、型別不對）時整個 job 會直接標成 `FAILED`，不會重試或降級成「沒有章節」
- 對話記憶只取最近 5 輪（`app/services/qa.py` 的 `_MEMORY_TURNS`），沒有依 token 數動態調整；長對話裡更早的內容不會被 LLM 看到
- HF Inference Providers 免費層沒有像 Groq 那樣公開逐模型的 TPM 數字，實際額度未知；`qa.py` 對歷史答案長度（`_MAX_HISTORY_ANSWER_CHARS`）、`max_tokens` 都有固定上限，沒有做真正依 tokenizer 精算的動態預算控制。這個呼叫沒有套用 `retry.py` 的訊息層級重試（見上面另一條已知限制），撞到當下這輪問答會直接失敗
- 問答的改寫/生成呼叫沒有套用 `app/services/retry.py` 的訊息層級 requeue 機制（那套是為 MQ 驅動的 pipeline 設計的）——`AskQuestion` 是同步查詢 RPC，中途失敗直接送一個 `error` chunk 讓這輪問答失敗，不會自動重試；使用者要自己重新送出問題
- chat/embedding model 選擇都受 HF Inference Providers 當下有哪些 provider 實際托管該模型影響很大，會隨時間變動（例如原本想用的 embedding 模型 `Qwen/Qwen3-Embedding-0.6B` 開發當下就查無任何 provider 托管）；換 `AI_HF_CHAT_MODEL`／`HF_EMBEDDING_MODEL` 前建議先用 `GET https://huggingface.co/api/models/{model}?expand[]=inferenceProviderMapping` 確認狀態是 `live`
- 換掉 Gemini 之後改用 `BAAI/bge-m3`（1024 維，原本 768 維），`embeddings` 欄位維度也跟著換了。還停在 768 維的舊表會讓服務拒絕啟動（baseline migration 檢查），要整張表 DROP 掉讓 migration 重建。已存在的 job 要重新跑過 pipeline 才能讓 RAG 問答恢復正常（新舊向量空間本來就不是同一套模型，就算維度沒變也不能直接混用）
- `Qwen/Qwen3.5-9B` 屬於 Qwen3 系列，預設會開 thinking mode：完整思考過程另外算 completion tokens、放在 HF 回應的 `message.reasoning`（不是混進 `content` 的 `<think>` 標籤，這點實測跟原本 Groq `qwen3.6-27b` 的行為不同）。**已踩過的坑**：不設 `max_tokens` 時 provider 預設只給 2048，稍長的輸入光思考就把預算燒光，`content` 直接是空字串（`finish_reason="length"`）但整個呼叫不會報錯——摘要/章節分段因此曾經整段是空的，pipeline 卻顯示成功；而且單純拉高 `max_tokens` 治標不治本，實測 500+ 段的章節分段呼叫就算給到 32768 還是會在思考階段被 HF gateway 504 timeout 打斷。目前的做法是透過 `hf_client.DISABLE_THINKING`（chat template 的 `enable_thinking=False`）直接關掉 thinking mode，所有呼叫 `hf_client.get_client()` 做 chat completion 的地方都要帶上；`strip_thinking()`／`stream_without_thinking()` 保留作為防禦性 fallback（防之後換模型/provider 又變回把思考混進 `content` 的行為），正常情況下是 no-op。換其他 HF 聊天模型時要重新確認是否還會有類似的 thinking-mode 行為
- 測試涵蓋 pipeline（`process_message()` 與重試分流，全部 mock 外部 I/O）、重試分類函式、consumer 的重試路由，以及資料庫 migration 跟 `transcript.edited` 的重算 embedding（對真的 Postgres）；摘要 / 章節 / 問答帶講者名稱（`tests/test_speaker_aware_pipeline.py`、`tests/test_qa.py`：`stream_answer()` mock 檢索、transcript client、HF client）；gRPC controller 只有 `GetSummary` 有 in-process 測試，問答 streaming 的 gRPC 層仍只靠手動 grpcurl smoke test
