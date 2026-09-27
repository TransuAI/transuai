# ai-service

音訊/影片逐字稿 + AI 分析平台的 AI Service。消費 Transcription Service 發出的 `transcription.completed` 事件，取得逐字稿、呼叫 HF Inference Providers 產生摘要，存進自己的 `ai_db`，並回寫 Job 狀態、發送 `ai.completed` 事件。是純內部服務（MQ 驅動），只暴露 gRPC 給其他內部服務查詢——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service)、[`transcription-service`](../transcription-service) 一致）。

## MVP 範圍

對照 [`../architecture-design.md`](../architecture-design.md) 2 / 3.4 / 4.4，AI Service 完整職責包含 embedding、RAG 問答、章節分段、多格式輸出。目前除了「消費事件 → 取逐字稿 → 產生摘要 → 回寫狀態 → 發完成事件」這條最短路徑之外，也做了章節分段（同一趟 pipeline 內，依逐字稿分段的時間戳切章節）跟 embedding + RAG 問答（pipeline 內把逐字稿分段轉成向量存進 `embeddings`；`AskQuestion` rpc 用 cosine similarity 找最相關片段，連同最近幾輪對話歷史一起餵給 LLM，以 server-streaming 方式即時回傳答案，成功後才連同來源時間戳存進 `qa_history`；`ListQaHistory` rpc 讀回一個 job 的完整問答紀錄）。「對話」的範圍見 [`CONTEXT.md`](./CONTEXT.md) 跟 [`docs/adr/0002-single-conversation-per-job.md`](./docs/adr/0002-single-conversation-per-job.md)。`export_outputs` 對應的功能還沒做，`ai_db` 目前有 `summaries`、`chapters`、`embeddings`、`qa_history`、`llm_usage`、`provider_keys`、`default_models`、`quizzes`、`quiz_questions`、`quiz_attempts`、`oauth_connections`、`oauth_pending_authorizations`、`oauth_clients`、`post_meeting_runs`、`action_proposals`、`post_meeting_settings` 十六張表。

原本摘要/章節分段/RAG 問答/embedding 全部用 Gemini API，開發時常撞到免費層的 429（額度）跟 503（過載）——尤其 embedding 免費層每天只有 100 次請求，測試幾個 job 就用完。第一次改版把生成類呼叫換成 Groq、embedding 換成 HF Inference API；後來 Groq 的 `qwen/qwen3.6-27b` 免費層 TPM 太小（8000 tokens/min），加上對話記憶之後很容易撞到 `413 Request too large`，第二次改版把生成類呼叫也一併換到 HF Inference Providers（`Qwen/Qwen3.5-9B`），現在摘要/章節分段/RAG 問答/embedding 全部用同一個 HF 帳號。取捨見 [`docs/adr/0003-hf-inference-providers-for-generation.md`](./docs/adr/0003-hf-inference-providers-for-generation.md)。之後生成類呼叫改走 OpenAI 相容介面（平台模型仍是同一個 HF 模型，走 HF 的 OpenAI 相容路由），為了之後支援使用者的自有金鑰，見 [ADR 0004](./docs/adr/0004-generation-calls-through-openai-compatible-interface.md)；embedding 仍用 `hf_client.py`。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework |
| API | gRPC（`AiService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費 | RabbitMQ（`pika`），消費 `transcription.completed`，發送 `ai.completed` / `job.failed` |
| 生成類呼叫 | 摘要、章節、問答都透過 OpenAI 相容介面（`openai` SDK，見 [ADR 0004](docs/adr/0004-generation-calls-through-openai-compatible-interface.md)）；平台模型走 HF Inference Providers 的 OpenAI 相容路由（`https://router.huggingface.co/v1`），回傳文字與 token 用量，錯誤分成暫時性與永久性 |
| 摘要 | 平台模型（預設 `Qwen/Qwen3.5-9B`，可用 `AI_HF_CHAT_MODEL` 換模型），把逐字稿全文丟給模型產生摘要；兩位以上講者時改成每行「名稱：文字」（見下方「講者」） |
| 章節分段 | 同一個平台模型，把逐字稿片段（含時間戳，兩位以上講者時每行 `[開始時間] 名稱：文字`）丟給模型，要求回傳 JSON 章節列表（title + start_time） |
| Embedding | HF Inference Providers 的 `BAAI/bge-m3`（1024 維，query/document 對稱，不用加任何 instruction 前綴）：pipeline 內把逐字稿分段轉成向量存進 `embeddings` |
| RAG 問答 | `AskQuestion` 把問題（有對話歷史時先用同一個平台模型做語意判斷 + 條件式改寫，見 `CONTEXT.md`「改寫後的問題」）轉成向量、用 pgvector cosine distance 找最相似的前 5 段，組成 context 連同最近 5 輪對話歷史一起餵給模型，用 `stream=True` 逐字串流生成回答；兩位以上講者時 context 每行帶講者**目前的**名稱（回答當下呼叫 `GetTranscript` 取得） |
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
- 要連結 Google 帳號才需要：`.env` 的 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`（Google Cloud Console 的「網頁應用程式」
  OAuth client，重新導向 URI 是 `http://localhost:5173/api/oauth/google/callback`，見 [`../infra/README.md`](../infra/README.md)）

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
2. 開一條背景 thread 消費 RabbitMQ 的 `transcription.completed`（主要業務入口，MQ 驅動）、`transcript.edited`（使用者編輯逐字稿後，更新問答用的 embedding）、`summary.regeneration.requested`（使用者要求重新產生摘要與章節）、`quiz.requested`（使用者要求產生測驗）跟 `post_meeting.requested`（使用者啟動會後處理）
3. 起 gRPC server，監聽 `8084`

## Pipeline

```
消費 transcription.completed { jobId, userId }（userId 是 Job 擁有者，用量記在他名下；升級前排入的舊訊息沒有，照常處理）
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

### 自有金鑰

使用者可以存入 OpenAI、Anthropic、Google Gemini、OpenRouter 的金鑰（每家一把，再存一次就是替換）。存入前先呼叫該廠商不收費、
需要金鑰的查詢 API 驗證（OpenRouter 的模型清單是公開的，所以改查「目前這把金鑰」）；只有 2xx 算通過，401／403 與其他 4xx 就拒絕並
說明原因（附上廠商自己的說明，例如 Gemini 對無效金鑰回 400），廠商暫時連不上也不存。密文綁定「使用者:廠商」，搬到別列就解不開。通過後用 AES-256-GCM 加密存進 `provider_keys`，主金鑰是環境變數 `KEY_ENCRYPTION_KEY`（`openssl rand -base64 32` 產生，
沒設定時不能存入自有金鑰，其他功能照常），之後只回傳末四碼。取捨見 [ADR 0005](docs/adr/0005-own-api-keys-encrypted-in-ai-service.md)。

### 會後處理（`post_meeting.requested`）

使用者對一個 Job 手動啟動的 agent（見 `CONTEXT.md`「會後處理」）：讀這場會議、查使用者的 Google 日曆、Google Tasks 與 Notion，把會後該做的事（排下次會議、會議紀錄的 email 草稿、待辦、Notion 會議紀錄頁）整理成
**行動提案**，等使用者確認（寫入類工具只會變成提案，見 [ADR 0007](docs/adr/0007-write-tools-become-action-proposals.md)）。

```
RequestPostMeeting(jobId, userId, timezone, uploadedAt)（Gateway POST /jobs/{jobId}/post-meeting，上傳時間是 Job 建立的時間）
  → 能不能跑：預設模型要是自有金鑰、支援工具呼叫的模型，或是平台模型而且部署設定了會後處理的平台模型（`AI_POST_MEETING_PLATFORM_MODEL`，
    預設沒有，見 ADR 0006、0008）；Google 或 Notion 至少一個已連結、沒失效
  → 已經有一份在跑（5 分鐘內）就回傳那一份（卡住的那份寫成 FAILED）；否則新增 status = RUNNING 的紀錄並存好，再排入 post_meeting.requested { runId, jobId, userId }
消費 post_meeting.requested
  → 已經結束或卡住的就不跑（卡住的寫成 FAILED，不花使用者的額度）
  → 清掉上一次留下的提案、記下這一次開始的時間（重試從頭來）→ GetTranscript、讀摘要與章節 → agent 迴圈：
      讀取類工具（讀摘要、讀章節、搜尋逐字稿、列出講者、查行事曆、看 Google Tasks 未完成的待辦、搜尋與讀取 Notion）真的執行，結果回給模型；
      寫入類工具（建立行事曆活動、建立 Gmail 草稿、建立待辦（Google Tasks 或 Notion）、建立 Notion 會議紀錄頁）檢查參數後存成 action_proposals（服務、工具、種類、參數），回給模型「已記錄為提案」；
      每一步把進度文字寫進紀錄；模型說結束就 COMPLETED
  → 工具呼叫到 15 次或超過 2 分鐘 → LIMIT_REACHED，保留已經產生的提案；每次呼叫模型前與每個工具呼叫前都檢查，超過的工具
    呼叫不執行、回給模型「未執行」（對話保持完整）。單一次模型呼叫本身沒有另外限時
```

- 工具在 `app/services/agent_tools.py`，每個是一份設定（說明、參數、讀取類或寫入類、進度文字）；每個外部服務是一組工具
  （`calendar_tools(...)`），沒連結或已失效的服務不提供它的工具，沒列出的工具 agent 看不到。Google 的工具是自己寫的程式，
  網址與授權方式跟著那組工具走；之後換成 MCP 時換掉那一組。Google 日曆與 Gmail 是自己用 Google API 寫的（`app/services/google_calendar.py`、
  `app/services/gmail.py`，不用官方遠端 MCP，見 ADR 0006）；Gmail 只有建立草稿（不寄出、沒有讀信的工具），收件人一律由使用者在確認時
  填（模型提的收件人會被清空），可以留空。寫入類工具有兩道檢查：模型提案時的 `handle`，與使用者確認時的 `check_confirmed`（沒有就跟
  `handle` 一樣）——使用者可以填模型不能填的欄位。
- Google Tasks 沒有官方的 MCP，也是自己用 Tasks API 寫的（`app/services/google_tasks.py`，同一次 Google 授權的 `tasks` 權限），只用使用者的
  預設清單：讀取類 `tasks_list_tasks` 列出還沒完成的待辦（避免重複提出），寫入類 `tasks_create_task`（提案種類 `google_task`）的提案是標題、內容、負責人、期限
  （YYYY-MM-DD）、依據的錄音時間——Google Tasks 沒有負責人與時間戳的欄位，執行時寫在內容的最前面。
- **待辦去處**（設定，`google_tasks` 或 `notion`，還沒選過是 Google Tasks；migration 0014 把已經指定了 Notion 待辦資料庫的人設成 `notion`）
  決定 agent 只拿到哪一個建立待辦的工具（執行提案時兩個都在，換了待辦去處之前的提案仍然可以執行）：Google Tasks 要已連結 Google，
  Notion 要已連結 Notion 而且指定了待辦資料庫；做不到時系統提示要 agent 不提待辦，`GetPostMeeting` 的 `hints` 也提醒使用者去設定。
- Notion 是官方遠端 MCP（`mcp.notion.com/mcp`，ai-service 是 MCP client，用 MCP Python SDK）：讀取類是 `notion_search`、`notion_fetch`
  （讀資料庫會拿到欄位結構）；寫入類只有在使用者指定了位置時才提供，而且一律寫到指定的地方——`notion_create_meeting_page`（在會議
  紀錄頁面底下建一頁）、`notion_create_todo`（待辦去處是 Notion 時才提供；在待辦資料庫新增一筆，欄位依資料庫結構，`title_property` 說哪一欄是標題；依據的時間戳與補充說明寫進那一筆的內文——
  人員類型的欄位填不了講者名字，負責人沒有文字欄位可填時也寫進內文），執行時都是 `notion-create-pages`。沒指定位置
  時系統提示要 agent 不提 Notion 動作，`GetPostMeeting` 的 `hints` 也提醒使用者去設定。Notion 回應的格式沒有正式文件，標題、data source
  ID、建立好的網址是寬鬆地從回應裡找出來的，還沒用真的 Notion 走過。
- 搜尋逐字稿先做正規化比對（全形半形、空白、標點），找不到再用雙字重疊的比例（至少 3/4）：語音辨識常把「3 月 24 日」寫成「3 月 24」。
- **用哪個模型**：預設模型是自有金鑰的就用它；是平台模型的，用部署設定的會後處理平台模型 `AI_POST_MEETING_PLATFORM_MODEL`
  （HF 路由的模型 ID，可以帶 `:供應商`——同一個模型不是每家供應商都支援工具呼叫，要指定；本機 k8s 設成
  `Qwen/Qwen3.8-27B:deepinfra`，見 ADR 0008），沒設定就不能跑。費用算在平台的 `HF_API_KEY` 上，跟摘要、問答、embedding 共用。
- 呼叫模型用 `llm_client.chat_with_tools`：assistant 訊息原封不動放回對話（Gemini 3 的 `thought_signature` 要帶回去）；工具參數
  不是合法 JSON（Groq 的 `tool_use_failed`）時重試那一輪，最多兩次、算進次數。系統提示寫明逐字稿是資料不是指令、寫入只會變成
  提案、上傳時間（依使用者的時區）、講者目前的名字、待辦去處與 Notion 位置（用不了的待辦去處、沒指定的 Notion 位置就不要提對應的動作）、這個 Job 之前已經建立過的事項（不要再提）、工具次數上限。
- **執行行動提案**（`ExecuteProposals`／`RetryProposal`，使用者確認之後）：在請求裡同步執行，逐項用使用者確認（可能改過）的
  最終參數呼叫對應的外部服務——跟 agent 同一份工具設定、同樣的參數檢查（寫入類工具多一個 `execute`）。每項記成 DONE（附建立好
  的項目網址）或 FAILED（附原因：參數不對、服務拒絕並附它的說明、連結已失效），沒勾選的不動、已經 DONE 的不再執行；失敗的可以
  改了再執行，或用同樣的最終參數單獨重試。執行時鎖住那個提案直到寫完結果，所以同一個請求列了兩次、兩個請求同時來，都只會建立
  一次。服務回了成功卻沒給網址時仍算 DONE（東西已經建立，重試會重複建立），只是沒有連結。
- **避免重複**：執行成功的提案記下指紋（`action_proposals.fingerprint`，`app/services/proposal_identity.py`）：服務、種類、
  正規化後的標題（全形半形、大小寫、空白、標點不算）與時間（行事曆活動是開始時間換成 UTC 到分鐘，Google Tasks 是期限，其他沒有）；
  Notion 待辦的標題是 `title_property` 指的那一欄（模型讀了資料庫結構後說哪一欄是標題）。指紋用的是使用者確認的最終參數；沒有標題就沒有指紋。migration 0015 之前
  執行的沒有存指紋，比對時從參數算。Notion 待辦沒有時間可比（期限是哪一欄不固定）；同一件待辦換了待辦去處（Google Tasks ↔ Notion）認不出來。
  下一次會後處理的系統提示列出這個 Job 已經建立過的事項；回應裡還沒執行、指紋跟這個 Job 其他次已建立的相同的提案標
  `previously_created`（前端顯示「上次已建立」、預設不勾選）。失敗的不算建立過。
- 暫時性失敗走訊息層級重試（`post_meeting.requested.retry.2s`／`.4s`），重試從頭來；最終失敗（含自有金鑰不能用——不改用平台模型）
  → FAILED 並附原因。「執行中」從這一次開始跑（還沒開始就從要求）起超過 5 分鐘回報成 FAILED。用量記在觸發的使用者名下，功能是 `post_meeting`。

### 已連結的帳號

使用者可以連結 Google（Calendar 查行程與建立活動、Gmail 建立草稿、Tasks）與 Notion（官方遠端 MCP），給會後處理用（目前用到 Google 日曆、Gmail 草稿、Google Tasks 與 Notion）。
每個服務是 `app/services/connections.py` 裡的一份設定（授權、換權杖、撤銷的網址、權限、是否 PKCE、是否動態註冊 client）。

- **開始連結**（`StartConnection`）：產生一次性的 `state`（10 分鐘內有效）記在 `oauth_pending_authorizations`，連同 Gateway
  放進瀏覽器 cookie 的值的雜湊（`browser_binding`：回呼時要帶回同一個值，state 才算數，別人的授權網址連不到使用者的帳號上），
  回傳授權網址；過期沒完成的授權在下一次開始連結時清掉。
  Google 用平台自己的 OAuth client（環境變數 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`，沒設定時不能連結 Google），
  `access_type=offline` 拿 refresh token；Notion 用 PKCE（S256），第一次先向 `mcp.notion.com/register` 動態註冊公開 client，
  依回呼網址存在 `oauth_clients` 重複使用。
- **完成連結**（`CompleteConnection`，Gateway 的回呼）：用 `state` 找回使用者（只能用一次），拿 code 換權杖，跟自有金鑰同一套
  AES-256-GCM 加密存進 `oauth_connections`（綁定「使用者:服務:權杖種類」）。權杖不會出現在任何回應裡。
- **續期**：要用存取權杖時快過期就先用 refresh token 換新（Notion 會連 refresh token 一起換）；對方拒絕就把連結標成已失效，
  暫時連不上則維持原狀。`ListConnections` 會順便確認，所以設定頁看得到失效。
- **中斷連結**（`DeleteConnection`）：向對方撤銷授權（Google 的 `/revoke`、Notion 的 `/token`），不論成敗都刪除權杖。

### 預設模型

使用者在設定頁選一個預設模型：平台模型，或某把自有金鑰底下的模型（OpenAI、Anthropic、Gemini 是 `model_catalog.py` 整理好的
清單；OpenRouter 可以輸入任意模型 ID，用 OpenRouter 公開的模型清單確認存在）。上傳後的摘要與章節（用 Job 擁有者的）、重新產生
（用要求的人的）、問答（用提問者的；問答也可以在提問當下臨時換模型）都用它；摘要記錄產生它的模型。自有金鑰被廠商拒絕（認證、額度、模型不存在）時直接失敗、
錯誤原因寫明廠商與原因，**不會**改用平台模型；429、5xx 照樣走訊息層級重試。換預設模型不會重做任何既有的內容；刪掉預設模型
正在用的金鑰時，預設模型改回平台模型。

### 用量

每一次 LLM 呼叫（摘要、章節、問答的回答與問題改寫、重新產生摘要與章節、測驗）結束時，記一筆**用量**到 `llm_usage`：使用者、Job、
功能、廠商、模型、金鑰來源、輸入 / 輸出 token（取廠商回報的數字，沒回報就是未知，不估算）、成功或失敗。失敗的呼叫也記
（通常沒有數字）；串流回答被中途放棄也算失敗。用量用自己的 session 立即寫入，跟摘要存檔無關；寫不進去只記 log，不讓
Job 失敗。embedding 不記。`ListJobLlmUsage`（一個 Job 逐筆）與 `SumUserLlmUsage`（一位使用者一段時間依模型加總）提供查詢，
Gateway 跟 transcription-service 的轉錄用量合併後給前端。

### 重新產生摘要與章節（`summary.regeneration.requested`）

```
RequestRegeneration(jobId)（Gateway POST /summary/{jobId}/regenerate）
  → 鎖住該 job 的摘要列；已經 RUNNING 且在 5 分鐘內 → 什麼都不做
  → regeneration_status = RUNNING、排入 summary.regeneration.requested { jobId, userId }（publisher confirms、短 timeout；失敗則 rollback）
消費 summary.regeneration.requested { jobId, userId }
  → GetTranscript（revision R）→ 排除已清空片段、帶上講者目前的名稱（同 pipeline）→ 摘要 + 章節都成功後才覆寫兩者
  → source_revision = R、regeneration_status = IDLE
```

暫時性失敗走訊息層級重試（`summary.regeneration.requested.retry.2s`／`.4s`）；最終失敗 → `regeneration_status = FAILED`，
舊內容保留（摘要在原本那一列上更新、跟章節同一個 transaction 寫入，不會只換掉一半）。RUNNING 超過 5 分鐘視為卡住（例如服務中途重啟），
`GetSummary` 對外回報成 FAILED，使用者看得到重試按鈕。全程不動 Job 狀態、不發 `ai.completed`／`job.failed`（工作區只在 COMPLETED 時顯示）。重新產生期間又被編輯的話，
source_revision 是讀到的 R，前端照樣會顯示過時。

### 測驗（`quiz.requested`）

```
RequestQuiz(jobId, userId, questionCount)（Gateway POST /jobs/{jobId}/quizzes）
  → questionCount 只能是 5、10、20
  → 新增一份 status = GENERATING 的測驗並存好，再排入 quiz.requested { quizId, jobId, userId }（publisher confirms、短 timeout；排入失敗就把它刪掉，什麼都不留）
消費 quiz.requested { quizId, jobId, userId }
  → GetTranscript（revision R）→ 每行「[開始時間] 文字」，排除已清空片段、兩位以上講者時帶名稱（同章節）
  → 用 userId 的預設模型出題，要求回 JSON 陣列 → 驗證（題數、題型、選擇題 4 個選項、正確答案在選項內、題目與解說不是空的）
  → 時間戳只留對得到某個片段開始時間的（依模型看到的、取到小數一位的時間比對，存片段真正的開始時間）
  → 題目與 status = COMPLETED、source_revision = R、產生的模型一起寫入（只寫還在 GENERATING 的：訊息重送或已經完成的不會再出題）
```

模型回傳的格式不對是永久性失敗（不重試，`status = FAILED` 並附原因）；暫時性失敗走訊息層級重試（`quiz.requested.retry.2s`／`.4s`），
用完就是 FAILED。自有金鑰不能用時直接失敗並附原因，不改用平台模型。GENERATING 超過 5 分鐘視為卡住，`ListQuizzes` / `GetQuiz`
回報成 FAILED（「產生逾時，請再產生一次」），使用者可以再產生一份。用量記在要求者名下，功能是 `quiz`。

作答（`SubmitQuizAttempt`）由後端計分：每題的選擇跟正確選項比對，連同答對題數存進 `quiz_attempts`（同一份測驗可以重做，
每次都留下）；列表的最佳成績是這份測驗所有作答裡答對題數的最大值。

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
| `RequestRegeneration` | 摘要與章節過時後要求重新產生（帶 `user_id`：要求的使用者，用量記在他名下）：狀態設 RUNNING、排入 `summary.regeneration.requested` 後立即回傳目前的摘要；已在跑（5 分鐘內）不重複排入；沒有摘要回 `NOT_FOUND`，排入失敗回 `UNAVAILABLE`（狀態不變） |
| `GetSummary` | 依 `job_id` 取得摘要、`source_revision`（依據的逐字稿 revision；小於逐字稿目前的 revision 就是過時）與 `regeneration_status`，`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |
| `ListChapters` | 依 `job_id` 取得章節列表（依 `sequence_no` 排序），`job_id` 不合法回 `INVALID_ARGUMENT`；沒有章節時回空列表，不算錯誤 |
| `AskQuestion` | 針對 `job_id` 的逐字稿內容做 RAG 問答（含最近 5 輪對話記憶），**server-streaming**：回傳 `stream AskQuestionChunk`（`oneof`: `sources` 恰好一次、`answered_by` 恰好一次、任意數量 `delta`、失敗時恰好一次 `error`，模型呼叫失敗時訊息點出廠商與原因）。可以帶 `model` 臨時換模型（只用在這一次，必須是提問者用得到的：平台模型、有金鑰的廠商整理好的清單，或他目前的預設模型；否則在送出任何 chunk 前回 `INVALID_ARGUMENT`），不帶就用預設模型；問題改寫與回答用同一個模型，`qa_history` 記錄回答的模型。`job_id`/`user_id` 不合法回 `INVALID_ARGUMENT`；還沒有 embedding（pipeline 沒跑完或該 job 沒有逐字稿分段）回 `NOT_FOUND`，這種情況一定發生在任何 chunk 送出之前；改寫/生成中途失敗改用 `error` chunk（stream 正常結束，不寫 `qa_history`），不是 gRPC 層級的錯誤。`user_id` 是 Gateway 驗證過 ownership 之後轉過來的，用來記錄 `qa_history`、決定用誰的預設模型與自有金鑰，不重新驗證 |
| `ListJobLlmUsage` | 依 `job_id` 列出這個 Job 的 LLM 用量（依時間升冪）：功能、廠商、模型、金鑰來源、輸入 / 輸出 token（廠商沒回報就不設定，proto3 `optional`）、成功或失敗；`job_id` 不合法回 `INVALID_ARGUMENT`，沒有紀錄回空列表 |
| `RequestQuiz` | 要求產生一份測驗（帶 `user_id`：要求的使用者，用他的預設模型、用量記在他名下）：新增 GENERATING 的測驗、排入 `quiz.requested` 後立即回傳（不含題目）；每次都是新的一份。題數不是 5、10、20 或 ID 不合法回 `INVALID_ARGUMENT`，排入失敗回 `UNAVAILABLE`（什麼都沒建立） |
| `ListQuizzes` | 一個 Job 的所有測驗（新的在前）：題數、狀態（GENERATING 超過 5 分鐘回報成 FAILED）、失敗原因、依據的逐字稿 revision、產生的模型、要求與完成時間、最佳成績（`best_correct_count`：所有作答裡答對最多的題數，沒作答過不設定）；不含題目 |
| `GetQuiz` | 一份測驗含題目（題型、題目、選項、正確選項、解說、依據的片段開始時間）與最佳成績；不存在或不屬於這個 `job_id` 回 `NOT_FOUND` |
| `ListConnections` | 使用者的已連結帳號，Google、Notion 各一筆：狀態（已連結、已失效、未連結）與連結時間；已連結的會先確認存取權杖還能用（過期就換新，換不到就是已失效） |
| `StartConnection` | 開始連結：記下 `state` 與 `browser_binding` 的雜湊（Notion 另外 PKCE，必要時先動態註冊 client），回傳授權網址；`redirect_uri` 是 Gateway 的回呼網址，`browser_binding` 不能是空的。不認得的服務回 `INVALID_ARGUMENT`，沒設定 Google OAuth client 或加密主金鑰回 `FAILED_PRECONDITION`，連不上 Notion 回 `UNAVAILABLE` |
| `CompleteConnection` | 完成連結：用 `state` 找回使用者、拿 `code` 換權杖並加密保存，回傳 `user_id`。`state` 不認得、過期、用過、屬於別的服務，或 `browser_binding` 對不上（不是開始連結的那個瀏覽器）回 `INVALID_ARGUMENT`；使用者拒絕（`error` 有值）或對方不肯換權杖回 `FAILED_PRECONDITION` |
| `GetPostMeeting` | 這個 Job 的會後處理：能不能跑（`available`，不能的話 `unavailable_reason` 是給使用者看的原因：預設模型是平台模型而沒有會後處理的平台模型、自有金鑰的模型不支援工具呼叫、Google 與 Notion 都沒連結或已失效）、提示（`hints`，能跑但有些事做不到，例如 Notion 已連結但還沒指定位置、待辦去處是 Google Tasks 但沒連結 Google）、最新一份紀錄（狀態、進度文字、失敗原因、模型、行動提案；還沒執行而跟這個 Job 其他次已建立的事項相同的提案標 `previously_created`）與之前的紀錄（`earlier_runs`，新的在前：提案、執行了哪些、結果與連結）；「執行中」超過 5 分鐘回報成 FAILED |
| `RequestPostMeeting` | 開始會後處理（帶瀏覽器時區與 Job 的上傳時間）：新增 RUNNING 的紀錄、排入 `post_meeting.requested`，回傳跟 `GetPostMeeting` 一樣的紀錄（新的這份與之前的）；已經有一份在跑就回傳那一份。不能跑回 `FAILED_PRECONDITION` 並附原因，時區不對回 `INVALID_ARGUMENT`，排入失敗回 `UNAVAILABLE`（什麼都沒建立） |
| `ExecuteProposals` | 執行勾選的行動提案（每項帶使用者確認的最終參數 JSON）：逐項呼叫對應的外部服務，記成 DONE（附網址）或 FAILED（附原因），回傳整份紀錄；沒勾選的不動、已 DONE 的不再執行，單項的參數不對或服務拒絕只讓那一項失敗。紀錄不屬於這個 job 回 `NOT_FOUND`，還在跑回 `FAILED_PRECONDITION`，提案不屬於這份紀錄回 `INVALID_ARGUMENT` |
| `GetPostMeetingSettings` | 會後處理的設定：Notion 的會議紀錄父頁面與待辦資料庫（ID、標題、網址；沒指定的不設定）、待辦去處（Google Tasks 或 Notion，還沒選過是 Google Tasks） |
| `UpdatePostMeetingSettings` | 儲存設定（整份換掉，網址是空字串是不指定，待辦去處是 UNSPECIFIED 是維持原本的——只換待辦去處不需要 Notion）；改過的位置先用 Notion MCP 的 `notion-fetch` 確認存在而且讀得到（會議紀錄要是頁面、待辦要是拿得到 data source ID 的資料庫），沒改的沿用、不再問 Notion。沒連結 Notion 回 `FAILED_PRECONDITION`，找不到、沒權限或不是資料庫回 `INVALID_ARGUMENT`（附原因），連不上 Notion 回 `UNAVAILABLE` |
| `RetryProposal` | 用上一次的最終參數重試一個 FAILED 的提案；不是 FAILED 回 `FAILED_PRECONDITION` |
| `DeleteConnection` | 中斷連結：向對方撤銷授權並刪除權杖；撤銷失敗時照樣刪除，`revoked` 是 false（對方說權杖本來就無效——授權早就不在了——算撤銷成功）。沒連結也算成功 |
| `SubmitQuizAttempt` | 送出一次作答（依題目順序、每題一個選項位置）：計分、存進 `quiz_attempts`，回傳答對題數與每題的選擇、正確選項、對錯、解說；同一份測驗可以重做，每次都保存。題數不對或選項超出範圍回 `INVALID_ARGUMENT`，還沒產生完成回 `FAILED_PRECONDITION`，不屬於這個 `job_id` 回 `NOT_FOUND` |
| `SumUserLlmUsage` | 一位使用者在 `[start, end)` 之間的 LLM 用量，依廠商、模型、金鑰來源加總：輸入 / 輸出 token（已知數字的加總）、呼叫次數（失敗也算）、廠商沒回報 token 的次數；Gateway 把「某個月」換成時間範圍。`user_id` 不合法或沒給 `start` / `end` 回 `INVALID_ARGUMENT`，沒有用量回空列表 |
| `SaveProviderKey` / `DeleteProviderKey` / `ListProviderKeys` | 自有金鑰（見上方「自有金鑰」）：存入或替換（先向廠商驗證，通過才加密存下，回傳末四碼；廠商不在清單、金鑰是空的或無效回 `INVALID_ARGUMENT` 附原因，廠商暫時連不上回 `UNAVAILABLE`，沒設定主金鑰回 `FAILED_PRECONDITION`）、刪除（沒有這把回 `deleted=false`；預設模型正在用它時一起改回平台模型，`default_model_reset=true`）、列出（只有末四碼） |
| `ListAvailableModels` / `GetDefaultModel` / `SetDefaultModel` | 預設模型（見上方「預設模型」）：可以選的模型、目前的預設模型、設定預設模型（沒有那個廠商的自有金鑰回 `FAILED_PRECONDITION`，清單外的模型或 OpenRouter 上不存在回 `INVALID_ARGUMENT`，OpenRouter 查不到回 `UNAVAILABLE`） |
| `ListQaHistory` | 依 `job_id` 取得這個 job 的完整問答紀錄（依 `created_at` 升冪；每則帶回答的 `model_provider` / `model`，記錄模型之前的是空字串），`job_id` 不合法回 `INVALID_ARGUMENT`；沒有紀錄回空列表，不算錯誤；不分頁（MVP 資料量小） |

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

生成類呼叫（摘要、章節、問答）的廠商邊界用 `tests/conftest.py` 的 **假 AI 廠商**（`fake_llm` fixture）：在 HTTP 層用
`httpx2.MockTransport` 假裝成 OpenAI 相容的廠商（`openai` SDK 3.x 底層是 `httpx2`），錄下送出的請求、回傳指定的內容／串流／
token 用量／錯誤，真正的 client 程式碼都會被執行到。`tests/test_llm_client.py` 用它驗證送出的請求、用量解析與錯誤分類，
`tests/test_qa.py` 用它驗證問答交給模型的上下文。

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
    quiz.py                       Quiz、QuizQuestion、QuizAttempt（SQLAlchemy ORM）
    post_meeting.py               PostMeetingRun、ActionProposal（SQLAlchemy ORM）
  controllers/
    ai_controller.py               AiServiceServicer 實作（摘要、章節、問答、重新產生、用量、自有金鑰、預設模型、測驗的 rpc）
  services/
    reembed.py                       消費 transcript.edited：只重算文字有變的片段的 embedding
    regeneration.py                  RequestRegeneration（排入自己的 queue）與消費 summary.regeneration.requested：重新產生摘要與章節
    quizzes.py                       RequestQuiz（排入自己的 queue）與消費 quiz.requested：產生測驗、失敗與卡住的判斷；作答的計分與保存
    post_meeting.py                  會後處理：能不能跑、RequestPostMeeting（排入自己的 queue）、消費 post_meeting.requested 的 agent 迴圈、執行與重試行動提案
    agent_tools.py                   會後處理 agent 的工具設定（讀取類／寫入類）：內部工具、Google 日曆、Gmail、Google Tasks 工具、Notion 工具、逐字稿的模糊搜尋
    google_calendar.py               Google Calendar API（列出行程、建立活動）
    gmail.py                         Gmail API（只有建立草稿，回傳打開草稿的網址）
    google_tasks.py                  Google Tasks API（預設清單：列出未完成的待辦、建立待辦）
    google_api.py                    自己寫的 Google API 工具共用的（Google 的錯誤說明）
    notion.py                        Notion 官方遠端 MCP 的 client（MCP SDK，每次呼叫開一次連線；測試換成程式內的假 MCP server）
    proposal_identity.py             行動提案建立的是哪一件事：標題與時間、指紋（避免重複）、給模型看的一行
    post_meeting_settings.py         會後處理的設定：Notion 的會議紀錄頁面與待辦資料庫（改過的位置儲存前用 Notion 確認）、待辦去處
    quiz_generator.py                出題：組 prompt、呼叫 llm_client、驗證模型回的 JSON（格式不對 raise QuizFormatError）、過濾時間戳
    consumer.py                      RabbitMQ consumer loop（pika）：「queue → 處理函式」對照表，每個被消費的 queue 各自宣告一組 `<queue>.retry.2s`／`.4s`，重試回到同一個處理函式
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    transcript_client.py               gRPC client，呼叫 transcription-service 的 GetTranscript
    llm_client.py                       生成類呼叫的 OpenAI 相容 client：chat()／stream_chat() 回傳文字與 token 用量，錯誤轉成 LlmError（廠商、模型、原因、是否暫時性）；平台模型設定（HF 路由 + DISABLE_THINKING）；strip_thinking()／stream_without_thinking() 防禦性濾掉 <think> 區塊
    summarizer.py                       摘要（呼叫 llm_client）
    chapter_generator.py                 章節分段（呼叫 llm_client）
    embedder.py                          HF Inference Providers 呼叫（embed_documents / embed_query）
    qa.py                                RAG 問答（含對話記憶）：條件式改寫問題 → 向量搜尋 → 組 context（多位講者時帶講者目前的名稱）+ 對話歷史 → streaming 生成回答
    providers.py                         自有金鑰支援的廠商（固定清單）：OpenAI 相容網址、驗證金鑰用的查詢 API
    key_encryption.py                    自有金鑰與已連結帳號權杖的 AES-256-GCM 加密；主金鑰來自 KEY_ENCRYPTION_KEY
    connections.py                       已連結的帳號：每個服務的 OAuth 設定、開始 / 完成連結、續期、中斷連結（撤銷）
    provider_keys.py                     存入自有金鑰：驗證 → 加密 → 存下
    model_catalog.py                     可以選的模型：OpenAI / Anthropic / Gemini 整理好的清單（標示能不能呼叫工具）、OpenRouter 模型 ID 的確認
    default_models.py                    預設模型：可選的模型、設定與讀取、刪金鑰時改回平台模型、resolve_chat_model()（背景工作與問答要用的模型，需要時解開自有金鑰）
    usage_meter.py                       用量記錄：UsageMeter（使用者、Job、功能）交給 llm_client，每次呼叫結束時記一筆；存檔失敗只記 log，不讓流程失敗
    speaker_context.py                   讓 AI 知道講者是誰：兩位以上講者時把片段組成「名稱：文字」（摘要）、`[時間] 名稱：文字`（章節），以及問答用的「片段起訖時間 → 講者目前的名字」；只有一位講者或舊逐字稿時維持原樣
    segment_times.py                     片段起訖時間的對應鍵（embedding 對回逐字稿片段用，重算 embedding 與問答共用）
    hf_client.py                         HF InferenceClient（lazy init），只剩 embedding 在用
    job_status_client.py                 gRPC client，呼叫 upload-service 的 UpdateJobStatus
    event_publisher.py                    發送 ai.completed / job.failed / summary.regeneration.requested / quiz.requested；connection_params() 供 consumer 與 gRPC 請求內發訊息共用
  repositories/
    summary_repository.py                  ai_db 存取（summaries）
    chapter_repository.py                  ai_db 存取（chapters）
    embedding_repository.py                ai_db 存取（embeddings，含向量相似度搜尋）
    qa_repository.py                       ai_db 存取（qa_history）
    llm_usage_repository.py                ai_db 存取（llm_usage）：每筆用量用自己的 session 立即寫入
    provider_key_repository.py             ai_db 存取（provider_keys）：存入或替換（upsert）、刪除、列出
    default_model_repository.py            ai_db 存取（default_models）
    post_meeting_repository.py             ai_db 存取（post_meeting_runs、action_proposals）
    quiz_repository.py                     ai_db 存取（quizzes、quiz_questions、quiz_attempts）：題目與「完成」一起寫入、最佳成績
  db/
    session.py                              engine / session / init_db（Alembic upgrade）
    migrations/                             Alembic migration（`versions/0001_baseline.py` 是導入前 create_all 建出的 schema，只補建缺少的表）
  proto_gen/                                 gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 已知限制 / 待辦

- 已連結的帳號：Google 的 `gmail.compose`（建立草稿）屬於 Google 的受限權限，應用程式通過 Google 的審查之前，只有 OAuth
  同意畫面登記的測試使用者能連結（還沒申請審查）。Google 日曆與 Gmail 不用官方的遠端 MCP（Developer Preview 只給 Workspace
  帳號、GA 前不能開放給網域外的使用者），會後處理改用自己寫的 REST API 工具，見 [ADR 0006](docs/adr/0006-post-meeting-agent-model-and-google-tools.md)。
  Google 的連結流程只用假的 OAuth 端點測過；Notion 的端點照它公開的
  `/.well-known/oauth-authorization-server` 設定，也還沒用真的帳號走過一次。Notion MCP 工具回應的格式沒有正式文件：設定位置時的
  標題與 data source ID、建立頁面後的網址是寬鬆地從回應文字裡找出來的（`app/services/notion.py`），測試只對程式內的假 MCP server。

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
- `Qwen/Qwen3.5-9B` 屬於 Qwen3 系列，預設會開 thinking mode：完整思考過程另外算 completion tokens、放在 HF 回應的 `message.reasoning`（不是混進 `content` 的 `<think>` 標籤，這點實測跟原本 Groq `qwen3.6-27b` 的行為不同）。**已踩過的坑**：不設 `max_tokens` 時 provider 預設只給 2048，稍長的輸入光思考就把預算燒光，`content` 直接是空字串（`finish_reason="length"`）但整個呼叫不會報錯——摘要/章節分段因此曾經整段是空的，pipeline 卻顯示成功；而且單純拉高 `max_tokens` 治標不治本，實測 500+ 段的章節分段呼叫就算給到 32768 還是會在思考階段被 HF gateway 504 timeout 打斷。目前的做法是透過 `llm_client.DISABLE_THINKING`（chat template 的 `enable_thinking=False`）直接關掉 thinking mode，平台模型的每次呼叫都會帶上（`platform_chat_model()`），HF 的 OpenAI 相容路由會原樣轉給模型；`strip_thinking()`／`stream_without_thinking()` 保留作為防禦性 fallback（防之後換模型/provider 又變回把思考混進 `content` 的行為），正常情況下是 no-op。換其他 HF 聊天模型時要重新確認是否還會有類似的 thinking-mode 行為
- 測試涵蓋 pipeline（`process_message()` 與重試分流，全部 mock 外部 I/O）、重試分類函式、consumer 的重試路由，以及資料庫 migration 跟 `transcript.edited` 的重算 embedding（對真的 Postgres）；摘要 / 章節 / 問答帶講者名稱（`tests/test_speaker_aware_pipeline.py`、`tests/test_qa.py`：`stream_answer()` mock 檢索與 transcript client，模型是假 AI 廠商）；gRPC controller 的 `GetSummary`、`RequestRegeneration`、`ListJobLlmUsage`、`SumUserLlmUsage`、測驗的四個 rpc 有 in-process 測試（測驗的背景產生也在 `tests/test_quizzes.py`，模型是假 AI 廠商），會後處理的四個 rpc 與 agent（`tests/test_post_meeting.py`：照劇本回應的假 AI 廠商、Google Calendar API 的假 HTTP）也是（真的 Postgres），問答 streaming 的 gRPC 層仍只靠手動 grpcurl smoke test
