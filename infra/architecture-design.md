# 音訊/影片逐字稿 + AI 分析平台 — 架構規劃文件

## 1. 系統概觀

### 1.1 產品定位
使用者上傳音訊/影片（限制 60 分鐘），系統自動產出逐字稿，並提供 AI 摘要、問答、多格式輸出等功能。差異化重點：

- **時間戳記精準跳轉問答**：AI 回答附上時間戳，可直接跳轉播放對應片段
- **一鍵生成多格式輸出**：Podcast 節目介紹、YouTube 描述、部落格文章、電子報、社群貼文（會議紀錄與待辦由會後處理寫進 Notion）
- **章節自動分段**：偵測話題轉換點，自動產出章節標題

### 1.2 核心資料流（非同步 Pipeline）

```
使用者上傳音訊/影片
  → Upload Service：存檔到物件儲存，寫入 Job record（status: pending）
  → 發送訊息「轉錄請求」到 MQ

Transcription Service 消費訊息
  → 抽音軌（若為影片，用 FFmpeg）
  → 呼叫 Deepgram Nova-3 一次完成轉錄與講者分離（每個字的 timestamp 與講者）
  → 依換講者、句末標點、停頓、約 15 秒上限把字切成片段（每個片段只屬於一位講者）
  → 中文轉成繁體（OpenCC s2tw，只換字形不換詞）
  → 更新 Job status: transcribing → transcribed
  → 逐字稿存入 DB（含片段 timestamp）
  → 發送訊息「轉錄完成」到 MQ

AI Service 消費訊息
  → 讀取逐字稿，呼叫 HF Inference Providers 產出摘要（兩位以上講者時輸入帶講者名稱，章節也是）
  → 呼叫 HF Inference Providers 依片段時間戳切章節
  → 呼叫 HF Inference Providers 把逐字稿片段轉成向量，存進 embeddings（供之後 RAG 問答用）
  → 依摘要與章節替 Job 取標題、判斷類型，回寫 Upload Service（失敗只記 log，不影響 Job）
  → 兩位以上講者時，依錄音裡明確講出的話替講者提名字建議（程式驗證後存進 speaker_name_suggestions；失敗只記 log）
  → 更新 Job status: summarizing → completed
  → 發送訊息「處理完成」到 MQ

Notification Service 消費訊息
  → 透過 WebSocket 推播給前端，更新使用者介面
```

> **實作現況**：摘要、自動章節分段、embedding/pgvector、RAG 問答都已實作（`ai_db` 有
> `summaries`/`chapters`/`embeddings`/`qa_history`，加上記錄每次 LLM 呼叫的 `llm_usage`、加密存放使用者自有金鑰的 `provider_keys`、使用者預設模型的 `default_models`、測驗的 `quizzes`/`quiz_questions`/`quiz_attempts`、已連結帳號的 `oauth_connections`/`oauth_pending_authorizations`/`oauth_clients`、會後處理的 `post_meeting_runs`/`action_proposals`/`post_meeting_settings`、網路搜尋用量的 `web_search_usage`、講者名字建議的 `speaker_name_suggestions`、講者數據的 `speaker_insights`/`speaker_insight_items`、刪掉的 Job 的 `deleted_jobs`、多格式輸出的 `generated_outputs`、譯文的 `translations`/`segment_translations`、決策紀錄的 `decisions`/`decision_extractions`、事實查核的 `fact_checks`/`claims`）。還沒做的見
> [8.5 未來規劃（尚未實作）](#85-未來規劃尚未實作)。
>
> **會後處理**（使用者手動啟動，不在上面的 pipeline 裡）：`POST /jobs/{jobId}/post-meeting` → ai-service 建立一筆執行中的紀錄、
> 排入自己的 `post_meeting.requested` → agent 讀這場會議、查使用者已連結的 Google 日曆、Google Tasks 與 Notion，讀取類工具真的執行、寫入類工具（建立行事曆活動、建立 Gmail 草稿、建立待辦（依設定建在 Google Tasks，或寫在 Notion 會議紀錄頁裡）、在指定的 Notion 頁面底下替每場會議建一個會議紀錄子頁面（含待辦清單））只存成
> 行動提案（`action_proposals`）→ 前端輪詢顯示進度與提案 → 使用者檢查、修改、勾選後按執行，ai-service 才用最終參數呼叫 Google
> 日曆、Gmail（草稿不寄出）、Google Tasks 或 Notion，每項記錄成功（附連結）或失敗（附原因，可以重試）（見 `ai-service/docs/adr/0007-write-tools-become-action-proposals.md`）。
> agent 跑完後另外問模型一次會議裡約好的會議（例如下次開會），由程式提成行事曆活動（本機模型在 agent 裡不會提，見
> `ai-service/docs/adr/0013-scheduled-meetings-asked-separately.md`）；一次會後處理合計最多 10 次 LLM 呼叫（agent 最多 2 分鐘，之後才問這一次）。
> 成功的記下指紋（服務、種類、正規化後的標題與時間）：同一個 Job 再跑一次時，agent 知道哪些已經建立過，跟它們相同的提案標示
> 「上次已建立」、預設不勾選；每一次的紀錄都保留，工作區看得到歷次的提案與結果。
> 用自有金鑰、支援工具呼叫的模型；部署有設定會後處理的平台模型（`AI_POST_MEETING_PLATFORM_MODEL`，預設沒有）時，平台模型的使用者
> 也能用（`0006`、`0008`）。

---

## 2. 服務拆分

| 服務 | 職責 | 技術棧 | 對外/對內 |
|---|---|---|---|
| **API Gateway** | 統一入口、JWT 本地驗證、REST↔gRPC 轉譯、限流 | Spring Boot（Web MVC）+ gRPC Client + Redis（限流計數、快取） | 對外 |
| **Auth Service** | 使用者註冊/登入、JWT 簽發與刷新 | Spring Boot + gRPC Server | 對內（僅供 Gateway 呼叫） |
| **Upload Service** | 檔案上傳、產生 presigned URL、Job 建立與狀態管理 | Spring Boot + gRPC Server | 對內（僅供 Gateway / 下游服務呼叫） |
| **Transcription Service** | 抽音軌（moviepy/ffmpeg）、呼叫 Deepgram 轉錄與講者分離、逐字稿產出與儲存 | Python + gRPC Server + Redis（逐字稿快取） | 對內（MQ 驅動，查詢走 gRPC） |
| **AI Service** | 摘要生成、章節分段、embedding + RAG 問答（見上方實作現況） | Python + gRPC Server | 對內（MQ 驅動，查詢走 gRPC） |
| **Notification Service** | Job 狀態即時推播 | Python + FastAPI（WebSocket）+ pika | 對內（WebSocket 對外） |
| **Frontend** | 使用者介面、播放器、時間戳跳轉 | React | 對外 |

> **技術棧更正**：API Gateway 不是用 Spring Cloud Gateway 的宣告式路由，是一般 Spring Boot Web MVC
> 應用，手刻 REST Controller，內部用 gRPC client 呼叫下游服務——本質上是個 REST↔gRPC 轉譯層。
> 除了 Gateway 以外的五個服務都**沒有對外 REST API**，彼此/對 Gateway 一律走 gRPC（同步查詢）
> 或 RabbitMQ（非同步事件），Notification Service 是唯一例外（WebSocket 直接對外）。

### 2.1 服務邊界原則（Database per Service）

每個服務各自擁有獨立 schema，不可直接跨服務查表：

- `auth_db`：使用者帳號與簽出去的 refresh token（`users`、`refresh_tokens`：只存雜湊，用來輪替與作廢）
- `upload_db`：檔案 metadata、Job 狀態機
- `transcription_db`：逐字稿內容、片段 timestamp、講者、轉錄用量
- `ai_db`：摘要、章節分段、embedding、問答歷史、LLM 用量、自有金鑰、預設模型、測驗、已連結的帳號、會後處理、網路搜尋用量、講者名字建議、講者數據、刪掉的 Job、多格式輸出、譯文、決策、事實查核（`summaries` / `chapters` / `embeddings` / `qa_history` / `llm_usage` / `provider_keys` / `default_models` / `quizzes` / `quiz_questions` / `quiz_attempts` / `oauth_connections` / `oauth_pending_authorizations` / `oauth_clients` / `post_meeting_runs` / `action_proposals` / `post_meeting_settings` / `web_search_usage` / `speaker_name_suggestions` / `speaker_insights` / `speaker_insight_items` / `deleted_jobs` / `generated_outputs` / `translations` / `segment_translations` / `decisions` / `decision_extractions` / `fact_checks` / `claims` 二十八張表）

跨服務資料需求（例如前端要同時顯示 Job 狀態 + 逐字稿 + 摘要）完全由 **Gateway 做 API Composition**：
Gateway 收到 REST 請求後呼叫對應下游服務的 gRPC API，把結果轉成 JSON 回傳，下游服務之間除了
MQ 事件外互不直接呼叫，也不會有即時跨庫 join。

> **授權模型**：transcription-service / ai-service 本身**不驗證 `x-user-id`**，只信任「呼叫方是
> 內部網路」（見兩邊 proto 的註解）——這點沒變，MVP 階段不打算讓每個下游服務各自重新實作一次
> ownership 邏輯。實際的「只能存取自己的 job」檢查現在收斂在 Gateway 這一層：轉發
> `GetTranscript`/`GetSummary`/`ListChapters`/`AskQuestion` 前，Gateway 會先呼叫 upload-service 的 `GetJob`
> 確認這個 job 是不是目前使用者的（`gateway/src/main/java/.../grpc/JobOwnershipGuard.java`），
> 不是就回 404，不會再往下游打。確認過的擁有者記在 Redis（cache-aside），之後的請求不用再跑這一趟內部 gRPC 往返。這個檢查只存在於走 Gateway
> 的路徑——如果之後有服務直接繞過 Gateway 打 transcription-service/ai-service，還是能查到任意
> job，這種情境目前假設不存在（下游服務只監聽 cluster 內部網路）。
> 唯一不經 Gateway、直接對外的 notification-service（WebSocket）自己做同樣的事：驗 access token，再問 upload-service 的
> `GetJob`（見 3.5）。
>
> 跨 Job 的查詢（決策頁 `GET /decisions`，見 `.scratch/decision-log`）沒有單一的 job 可以檢查：Gateway 先向 upload-service 列出**目前
> 使用者自己的** Job，只把那些 job id 交給 ai-service，再加上從 token 來的 `user_id`；ai-service 依 `user_id` 與 job id 兩個條件過濾。

---

## 3. API 設計

以下都是 **Gateway 對外的 REST API**（實際協定見上方 2 節：Gateway 內部呼叫下游服務一律走 gRPC，
proto 定義在 `infra/proto/*.proto`）。下游服務本身沒有對外 REST endpoint。所有 API 都經過 gateway 的限流（每位使用者、沒登入的
每個 IP，花錢的功能另外更嚴），超過回 429，見 `gateway/README.md`「限流」。

### 3.1 Auth Service

```
POST   /auth/register          註冊（email 已存在回 409/ALREADY_EXISTS，成功直接簽發 token，不用再呼叫一次 login；同一個 IP 註冊太多次回 429）
POST   /auth/login             登入，回傳 access token、refresh token 設在 httpOnly cookie（email/password 任一錯誤都回 401，不細分以避免帳號列舉；猜密碼太多次回 429，見 gateway README「限流」）
POST   /auth/refresh           用 cookie 裡的 refresh token 換發新的 access token，cookie 換成新的 refresh token（舊的作廢；已換發過的再被用視為被盜，整串作廢）
POST   /auth/logout            登出：作廢 cookie 裡的 refresh token 所在的那一串、清掉 cookie（不需要 access token）
POST   /auth/logout-all        登出所有裝置：作廢登入者所有的 refresh token、清掉 cookie
POST   /auth/account/delete    刪除帳號：body { password }（密碼錯 403、猜太多次 429）；刪掉使用者、發 account.deleted，其他服務清掉他的資料（用量去識別化）；
                                刪除後還沒過期的 access token 也被擋下（gateway 在 Redis 記 15 分鐘）
GET    /auth/me                取得目前使用者資訊（需帶 access token）
```

**JWT 機制**：HMAC（HS256/HS384，視 secret 長度而定）簽章，`JWT_SECRET` 由 auth-service 與
gateway 共用同一把。access token 15 分鐘、refresh token 7 天過期（皆可透過
`app.jwt.access-token-ttl-minutes` / `app.jwt.refresh-token-ttl-days` 覆蓋）。refresh token 記在 auth-service 的
`refresh_tokens`（只存雜湊）：每次換發輪替、登出作廢，已經換發過的又被用一次視為被盜、整串作廢（見 `auth-service/README.md`）。
access token 仍是 stateless，登出後有效到過期（最多 15 分鐘）。前端不把 token 存在 localStorage：access token 只放在記憶體，
refresh token 由 gateway 放在 httpOnly、Secure、`SameSite=Strict`、`Path=/api/auth` 的 cookie，重新整理頁面時用它換新的 access token
（見 `gateway/README.md`「refresh token 的 cookie」）。所以**前端與 API 要在同一個網站**（同源最單純：前端經反向代理的 `/api` 呼叫 gateway）。Gateway 收到請求後在本地驗證 access token（不會回頭呼叫
auth-service 確認），驗證通過後把 user id 透過 gRPC metadata `x-user-id` 轉發給下游服務。

### 3.2 Upload Service

```
POST   /uploads/presign         取得物件儲存的 presigned upload URL（尚未建立 Job；帶檔案長度，先檢查每月用量上限）
POST   /uploads/complete        前端上傳完成後呼叫，建立 Job record 並發送 transcription.requested 事件；
                                 body 的 transcriptionLanguage 是轉錄語言（zh-TW 預設 / en / auto）
GET    /jobs/{jobId}            查詢單一 Job 狀態與基本資訊（含標題、類型）
PATCH  /jobs/{jobId}            使用者改標題／類型 { title?, category? }；改過的欄位 AI 之後不會再寫（upload-service 的 UpdateJob）
GET    /jobs/{jobId}/media-url  取得該 Job 媒體檔案的 presigned 播放 URL（見 docs/adr/0002-presigned-get-url-for-media-playback.md）；
                                  query download=true 時改給「以附件方式下載、存成原始檔名」的 URL（前端匯出 → 下載原始檔）
GET    /jobs                    查詢使用者的 Job（分頁，query: page（從 1 開始）, pageSize, query（標題或檔名包含，不分大小寫）, category）
DELETE /jobs/{jobId}            刪除 Job 與相關資料（包括筆記）
GET    /jobs/{jobId}/notes      筆記（依時間排序，沒有時間的在最後）；POST 新增 { timeSeconds?, text?, source? }，
                                PATCH /jobs/{jobId}/notes/{noteId} 改文字，DELETE 刪除（upload-service 的 NoteService）
```

Job 狀態機：
```
pending → uploading → uploaded → transcribing → transcribed
  → summarizing → completed
  （任一階段失敗 → failed，記錄 error reason）
```

### 3.3 Transcription Service

```
GET    /transcripts/{jobId}            取得逐字稿全文（含片段 timestamp）
GET    /transcripts/{jobId}/segments   只取片段列表（前端目前沒有用這支：播放同步直接用上面那支的 segments）
PATCH  /transcripts/{jobId}/segments/{segmentId}   編輯片段文字，body { "text": string }（空字串＝清空、
                                   送回 originalText＝還原），回傳 { segment, revision }
PATCH  /transcripts/{jobId}/speakers/{label}       替講者命名，body { "name": string }（空字串＝恢復預設名稱
                                   「講者 N」），回傳 { speaker, revision }
PUT    /transcripts/{jobId}/segments/{segmentId}/speaker   改片段的講者，body { "speakerLabel": string } 或
                                   { "newSpeaker": { "name": string } }，回傳 { segment, speakers, revision }
```

兩個 GET 都是 Gateway 呼叫同一支 gRPC `GetTranscript` 後，視需要只回傳 `segments` 欄位。其餘三支都是使用者對逐字稿的
**編輯**（定義見 `transcription-service/CONTEXT.md`），片段的起訖時間與切分永遠不變：

- `PATCH …/segments/{segmentId}` → `UpdateSegmentText`：改片段文字，以未清空片段重組 `fullText`。
- `PATCH …/speakers/{label}` → `RenameSpeaker`：替講者命名。
- `PUT …/segments/{segmentId}/speaker` → `AssignSegmentSpeaker`：把片段改成另一位講者，或新增講者給它。

每次實際改動都讓 `revision` +1，並發出 `transcript.edited`（見 5.）：ai-service 比對片段文字，只重算文字有變的
embedding、只重翻譯文裡文字有變的片段（清空的譯文刪掉）——改名、改講者不動文字，所以不用重算；摘要、章節與測驗則因為 `revision` 變大被標示為過時。轉錄本身完全是
**MQ 驅動**（消費 `transcription.requested`），沒有另外開一支「觸發轉錄」的 API。

逐字稿回傳格式範例（`language` 是轉錄時指定的語言代碼，例如 `zh-TW`；講者分離之前的舊 Job 存的是 Whisper
回傳的語言全名，例如 `Chinese`。中文逐字稿在存檔前已轉成繁體，見 `transcription-service/README.md` Pipeline 一節）。
`speakers` 是這個 Job 的講者（依 `displayOrder` 排序），`displayName` 由 transcription-service 決定（自訂名稱，否則
「講者 N」）；片段的 `speakerLabel` 指向其中一位。舊 Job 沒有講者資訊：`speakers` 是空的、`speakerLabel` 是 `null`：
```json
{
  "jobId": "uuid",
  "language": "zh-TW",
  "segments": [
    { "id": "uuid", "startTime": 12.3, "endTime": 15.8, "speakerLabel": "S1",
      "text": "今天想聊的主題是...", "originalText": "今天想聊的主題是..." }
  ],
  "fullText": "...",
  "revision": 0,
  "speakers": [
    { "label": "S1", "displayName": "講者 1", "displayOrder": 1 }
  ]
}
```

### 3.4 AI Service

```
GET    /summary/{jobId}                 取得摘要（含 sourceRevision：依據的逐字稿 revision，前端比對判斷過時；
                                         regenerationStatus：IDLE / RUNNING / FAILED；modelProvider / model：產生它的模型）
POST   /summary/{jobId}/regenerate      摘要與章節過時後，在背景依最新逐字稿重新產生兩者，回 202（Job 狀態不變，
                                         前端每 3 秒輪詢 GET /summary 直到不是 RUNNING）
GET    /chapters/{jobId}                取得章節列表
POST   /jobs/{jobId}/quizzes            產生一份測驗，body { "questionCount": 5 | 10 | 20 }，回 202（背景產生，前端每 3 秒
                                         輪詢列表直到不是 GENERATING）
GET    /jobs/{jobId}/quizzes            這個 Job 的測驗（新的在前，不含題目）：狀態、失敗原因、依據的 revision、產生的模型、最佳成績
GET    /jobs/{jobId}/quizzes/{quizId}   一份測驗含題目、選項、正確答案、解說、依據的時間戳
POST   /jobs/{jobId}/translations       譯文：翻譯逐字稿，body { "language": zh-TW | en | ja | ko }，回 202（背景一批一批翻、每批存檔，
                                         前端每 3 秒輪詢）；一種語言一份，翻好的再要求是補翻缺的
GET    /jobs/{jobId}/translations       各語言的狀態與進度
GET    /jobs/{jobId}/translations/{language}  一種語言含片段的譯文（翻譯中也有已經翻好的）
DELETE /jobs/{jobId}/translations/{language}  刪掉一種語言的譯文（翻譯中也可以），回 204；沒有這種語言回 404
POST   /jobs/{jobId}/decisions/extract  決策紀錄：抽出（或重新抽出）這場的決策，回 202（背景抽，前端每 3 秒輪詢）；會議、訪談
                                         轉錄完也會自動抽；重新抽只換掉 AI 抽的、使用者沒改過的
GET    /jobs/{jobId}/decisions          這個 Job 的抽取紀錄（沒抽過是 null）與決策（決定、理由、沒選的選項、提出者、暫定、時間點與原話、
                                         取代了較早會議的哪一個、被後來的哪些取代）
POST   /jobs/{jobId}/decisions          使用者自己新增一個決策（時間點可以沒有），回 201
PATCH  /jobs/{jobId}/decisions/{id}     修改決策的內容（時間點與原話不變），之後重新抽也保留
DELETE /jobs/{jobId}/decisions/{id}     刪除：AI 抽的只是隱藏（重新抽時不再出現），使用者新增的直接刪掉，回 204
POST   /decisions/ask                   問決策（SSE，跟問答一樣經 Gateway 轉發）：body { question, category?, jobIds? }，只根據使用者自己
                                         （篩選範圍內）的決策回答；先送 sources（依據的決策與它們的 Job，順序就是 [n]），再送 model、delta；
                                         找不到相關的決策時不呼叫模型，直接說沒有
GET    /decisions?q=&category=&jobId=… 決策頁（jobId 可以給好幾個）：使用者所有 Job 的決策（每個帶 Job 的標題、類型、上傳時間），沒有 q 時依上傳時間由新到舊
                                         的時間軸，有 q 時是搜尋（字與意思，依符合程度）；Gateway 先向 upload-service 列出使用者自己的
                                         Job（類型的篩選在那裡），只問 ai-service 這些 Job 的決策，ai-service 再依 user_id 過濾
POST   /jobs/{jobId}/fact-check         事實查核：標出這個 Job 可以查核的主張（不花搜尋次數），回 202（背景標，前端每 3 秒輪詢）；
                                         重新標出時查核過的保留
GET    /jobs/{jobId}/fact-check         標出主張的紀錄（沒標過是 null）與主張（講者、時間點、原話、整理過的陳述、種類、查核的結論）
POST   /jobs/{jobId}/outputs            多格式輸出：產生一份，body { "format", "platform"?（社群貼文必填）, "instruction"? }，回 202
                                         （背景產生，前端每 3 秒輪詢列表）；每次都是新的一份；Job 的標題由 Gateway 一起帶給 ai-service
GET    /jobs/{jobId}/outputs            這個 Job 的輸出（新的在前，含 Markdown 內容、狀態、依據的 revision、模型）
GET    /jobs/{jobId}/outputs/{outputId} 一份輸出
PATCH  /jobs/{jobId}/outputs/{outputId} 使用者修改內容 { "content" }（只有完成的可以改；改了記 editedAt）
POST   /jobs/{jobId}/speaker-insights   講者數據的 AI 判斷（每位講者提出的問題、可能的打斷），回 202（背景分析，前端每 3 秒輪詢）；
                                         一個 Job 一份，再分析完成才取代
GET    /jobs/{jobId}/speaker-insights   目前這一份：狀態、依據的 revision、模型、項目（類型、講者、被打斷的講者、時間、原話）
GET    /me/post-meeting-settings        會後處理的設定：Notion 的會議紀錄位置（沒指定是 null）、待辦去處
                                         （GOOGLE_TASKS / NOTION：放在 Notion 會議紀錄裡）
PUT    /me/post-meeting-settings        儲存設定，body { notionMeetingsPageUrl, todoDestination }
                                         （網址空的就是不指定，todoDestination 是 null 就不變）；
                                         改過的位置先向 Notion 確認（沒改的沿用），沒連結 Notion 回 409、找不到或種類不對
                                         （會議紀錄要是頁面、待辦要是資料庫）回 400、連不上回 503
GET    /jobs/{jobId}/post-meeting       會後處理：能不能跑（不能的話附原因）、最新一份紀錄（狀態、進度文字、行動提案，
                                         跟之前已建立過的相同的標 previouslyCreated）與之前的紀錄（earlierRuns）
POST   /jobs/{jobId}/post-meeting       開始會後處理，body { "timezone" }，回 202（背景跑 agent，前端每 3 秒輪詢 GET）；
                                         不能跑回 409 並附原因
POST   /jobs/{jobId}/post-meeting/{runId}/execute  執行勾選的行動提案，body { "proposals": [{ proposalId, arguments }] }
                                         （確認、可能改過的最終參數）；回傳每項的結果（成功附連結、失敗附原因）
POST   /jobs/{jobId}/post-meeting/{runId}/proposals/{proposalId}/retry  用同樣的最終參數重試一個失敗的提案
POST   /jobs/{jobId}/quizzes/{quizId}/attempts  送出一次作答，body { "answers": number[] }；後端計分並保存，回傳分數與每題結果
GET    /qa/{jobId}                      取得這個 job 的完整問答紀錄（對話記憶跟顯示共用同一份資料；每則附回答的 modelProvider / model、
                                         有沒有查網路 webSearch 與網路來源 webSources）
POST   /qa/{jobId}                      RAG 問答（含對話記憶），body { "question": string, "model"?: { provider, model },
                                         "webSearch"?: boolean }（model 只用在這一次提問，省略就用預設模型；webSearch 為 true 時這一題
                                         也用 Tavily 查一次網路，見 ai-service ADR 0014），回傳 text/event-stream（SSE，逐字串流，含一個
                                         說明由哪個模型回答的 model event；查了網路時多一個 web_sources event；回答過程的每一步是
                                         step event：理解問題、在內容裡找段落、查網路、撰寫回答），不是一次性 JSON
GET    /ai/models                       可以選的模型：平台模型，加上有自有金鑰的廠商整理好的清單（標示能不能呼叫工具）；
                                         有 OpenRouter 金鑰時可以自己輸入模型 ID（openrouterCustom）；問答能不能查網路（webSearch）
GET    /me/default-model                目前的預設模型（沒選過就是平台模型）
PUT    /me/default-model                設定預設模型，body { "provider", "model" }；清單外的模型或 OpenRouter 上不存在回 400、
                                         沒有那個廠商的自有金鑰回 409、OpenRouter 查不到回 503；不會重做既有內容
GET    /me/provider-keys                自有金鑰列表（只有廠商、末四碼、存入時間）
PUT    /me/provider-keys/{provider}     存入或替換自有金鑰，body { "key": string }；先向廠商驗證，無效回 400（附原因）、
                                         廠商暫時連不上回 503、伺服器沒設定加密主金鑰回 409，都不會存
DELETE /me/provider-keys/{provider}     刪除自有金鑰，回 { deleted, defaultModelReset }（預設模型正在用它時改回平台模型）
GET    /jobs/{jobId}/speaker-suggestions  講者名字建議：[{ speakerLabel, name, evidenceStartTime, evidenceText, status }]
PUT    /jobs/{jobId}/speaker-suggestions/{label}  標成 applied（前端先改名）或 dismissed，body { "status" }
GET    /jobs/{jobId}/usage              這個 Job 的用量（每一次 LLM 呼叫、轉錄與網路搜尋，依時間排序，附總計）；Gateway 向
                                         ai-service（LLM、網路搜尋）與 transcription-service（轉錄）分別查詢再合併
GET    /me/connections                  已連結的帳號：Google、Notion 各自的狀態（已連結、已失效、未連結）與連結時間
GET    /me/connections/{service}/authorize  回傳 { authorizeUrl }，前端把使用者轉過去連結（前端的 JWT 在 header 裡，
                                         瀏覽器轉址帶不過來，所以不是 302）；同時設 HttpOnly cookie 把這次授權綁定在這個瀏覽器
GET    /oauth/{service}/callback        Google / Notion 的回呼（不需要 JWT，使用者由 state 認出來，還要帶回同一個 cookie）；完成後轉回
                                         前端設定頁 ?connected= 或 ?connection_failed=
DELETE /me/connections/{service}        中斷連結：向對方撤銷授權並刪除權杖，回 { revoked }
GET    /me/usage?month=YYYY-MM          登入者某個月（台灣時間，省略就是這個月）的用量：LLM 依模型與金鑰來源、轉錄依模型加總；
                                         Gateway 把月份換成時間範圍，向兩個服務分別查詢；網路搜尋成功 / 失敗各幾次；附上每月的
                                         用量上限（轉錄分鐘數、平台模型 token、網路搜尋次數）。到了上限時，上傳、要用平台模型的
                                         AI 功能、查網路的問答回 429，見 gateway README
```

都已實作，對應 ai-service 的 gRPC `GetSummary`/`ListChapters`/`AskQuestion`/`ListQaHistory`/`RequestRegeneration`/`RequestQuiz`/`ListQuizzes`/`GetQuiz`/`SubmitQuizAttempt`/`ListConnections`/`StartConnection`/`CompleteConnection`/`DeleteConnection`/`GetPostMeeting`/`RequestPostMeeting`/`ExecuteProposals`/`RetryProposal`/`GetPostMeetingSettings`/`UpdatePostMeetingSettings`/`ListJobLlmUsage`/`SumUserLlmUsage`/`SaveProviderKey`/`DeleteProviderKey`/`ListProviderKeys`/`ListAvailableModels`/`GetDefaultModel`/`SetDefaultModel`（用量另外也呼叫 transcription-service 的 `ListJobTranscriptionUsage`/`SumUserTranscriptionUsage`），
細節見 [`gateway/README.md`](../gateway/README.md) 的 API 表跟
[`ai-service/README.md`](../ai-service/README.md)。`AskQuestion` 是 server-streaming
（原本是 unary），`POST /qa/{jobId}` 因此改回傳 SSE 而不是單次 JSON——見
[`docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](./docs/adr/0001-sse-via-gateway-for-streaming-qa.md)。
「對話」的範圍是整個 job，沒有獨立的 conversation/thread 概念，見
[`ai-service/docs/adr/0002-single-conversation-per-job.md`](../ai-service/docs/adr/0002-single-conversation-per-job.md)。
多格式輸出（LLM 依摘要與章節寫成要發出去的新文件）的路徑是 `/jobs/{jobId}/outputs`（見下）——刻意**不用** `/export`：「匯出」這個詞已經指前端把既有內容（逐字稿、譯文、摘要、章節、問答、測驗、原始檔）轉成檔案下載，
兩者不同（見 `frontend/CONTEXT.md`、`ai-service/CONTEXT.md`）。文字格式的匯出（TXT/SRT/VTT/Markdown、複製）
在前端產生、沒有後端 API；唯一跟後端有關的是「下載原始檔」用的 media-url `download` 參數（見 3.2）。

問答給模型的內容是整段的摘要與章節加上檢索到的片段（概括性的問題靠前者、細節靠後者，見 `ai-service/docs/adr/0012-qa-answers-from-summary-chapters-and-passages.md`）。回答當下會同步呼叫 transcription-service 的 `GetTranscript`（2 秒逾時），拿講者**目前的**名字標在檢索到的片段前面（兩位以上講者時）；逾時或失敗就照樣回答、不帶名字。

### 3.5 Notification（WebSocket，Gateway 不經手，前端直連 notification-service）

```
WS     /ws/jobs/{jobId}         訂閱單一 Job 的狀態更新事件
```

連上之後第一則訊息要帶 access token（瀏覽器的 WebSocket 不能帶 `Authorization` 標頭，token 也不放網址）：
`{ "type": "auth", "accessToken": "..." }`。notification-service 本地驗 JWT（跟 Gateway 同一把 `JWT_SECRET`），
再 gRPC 問 upload-service 的 `GetJob` 確認 Job 是這位使用者的（跟 Gateway 的 ownership 檢查一樣），通過才回
`{ "type": "subscribed", "jobId": "uuid" }` 並開始推播；不通過用關閉代碼告訴前端：`4401` token 不能用（前端換發後再連）、
`4404` 不是你的 Job、`4429` 超過同時連線數上限（每位使用者 10、每個來源 IP 20，可調）、`1011` 問不到 upload-service。
細節見 `notification-service/README.md`。

事件格式依觸發的 MQ 訊息而不同（見 5. 訊息佇列設計）：
```json
// 消費 ai.completed 時廣播
{ "jobId": "uuid", "status": "COMPLETED", "progress": 100 }

// 消費 job.failed 時廣播
{ "jobId": "uuid", "status": "FAILED", "stage": "transcription", "errorReason": "..." }
```

---

## 4. 資料庫 Schema

> 下面的表都是實際跑起來的 schema（Java 服務由 Hibernate `ddl-auto=update` 依 JPA entity
> 自動建表；Python 服務（transcription-service、ai-service）用 Alembic 版本化 migration（`app/db/migrations`，
> 啟動時自動升級）。這裡列出的 SQL 是對應內容，不是 migration 原文）。

### 4.1 auth_db

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

另外有 `refresh_tokens`（Hibernate 依 entity 建表）：每個簽出去的 refresh token 一列——`id`（JWT 的 `jti`）、`user_id`、
`family_id`（同一次登入一路換發出來的）、`token_hash`（SHA-256）、`expires_at`、`created_at`、`revoked_at`、
`revoked_reason`（`ROTATED` / `LOGGED_OUT` / `REUSED`）。
刪除帳號時刪掉使用者與他的 `refresh_tokens`，`account.deleted` 寫進 `outbox_events`（欄位跟 upload_db 的一樣，見 4.2）。

### 4.2 upload_db

```sql
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20) NOT NULL,         -- audio / video
    file_size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(500) NOT NULL,     -- MinIO/S3 路徑
    duration_seconds INT,
    transcription_language VARCHAR(10),     -- zh-TW / en / auto（上傳時選的轉錄語言；之前的 Job 是 NULL，當成中文）
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    error_reason TEXT,
    title VARCHAR(100),                     -- 標題：AI 依內容取的或使用者改的；NULL 顯示檔名（upload-service CONTEXT.md）
    category VARCHAR(20),                   -- 類型：meeting / lecture / interview / podcast / video / other
    title_set_by_user BOOLEAN,              -- 使用者改過就是 true，AI 之後不再寫這個欄位
    category_set_by_user BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);

-- 筆記（upload-service CONTEXT.md）：釘在錄音某個時間（或不釘）的一段文字；只有時間沒有文字的是書籤。刪除 Job 時一起刪。
CREATE TABLE job_notes (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,
    time_seconds DOUBLE PRECISION,          -- NULL＝沒釘時間（這時 text 一定有內容）
    text VARCHAR(2000) NOT NULL,
    source VARCHAR(16) NOT NULL,            -- manual / qa（從問答存的）
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_job_notes_job_id ON job_notes(job_id);

-- outbox：要發的事件跟引起它的變更在同一個交易寫入，排程送到 RabbitMQ（broker 確認收到才刪）。目前只有 job.deleted。
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    exchange VARCHAR(128) NOT NULL,         -- 送到哪個 fanout exchange
    payload TEXT NOT NULL,                  -- JSON
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_outbox_events_created_at ON outbox_events(created_at);
```

### 4.3 transcription_db

```sql
-- id 由應用程式產生（uuid4），不靠資料庫預設值
CREATE TABLE transcripts (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    language VARCHAR(10),
    full_text TEXT,                         -- 以未清空片段依換行重組（編輯後）
    revision INT NOT NULL DEFAULT 0,        -- 每次編輯 +1，供 AI 產出比對依據的版本、判斷是否過時
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX ix_transcripts_job_id ON transcripts(job_id);

CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY,
    transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    start_time NUMERIC(10,2) NOT NULL,
    end_time NUMERIC(10,2) NOT NULL,
    speaker_label VARCHAR(50),              -- 說這個片段的講者（speakers.label）；NULL＝沒有講者資訊（舊 Job）
    text TEXT NOT NULL,                     -- 目前的文字；空字串＝已清空片段
    original_text TEXT NOT NULL,            -- 人工編輯前的機器產出，供還原
    sequence_no INT NOT NULL
);

CREATE TABLE speakers (
    id UUID PRIMARY KEY,
    transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    label VARCHAR(50) NOT NULL,             -- 這個 Job 內的標籤（S1、S2…，依第一次開口的順序）
    display_order INT NOT NULL,             -- 從 1 開始；預設名稱「講者 N」與前端顏色依此決定
    name VARCHAR(100),                      -- 使用者取的名稱；NULL＝顯示預設名稱
    UNIQUE (transcript_id, label)
);

-- 轉錄用量：每次呼叫語音辨識服務一筆（LLM 用量在 ai_db）
CREATE TABLE transcription_usage (
    id UUID PRIMARY KEY,
    user_id UUID,                           -- Job 擁有者；升級前排入的舊訊息沒有
    job_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,          -- deepgram
    model VARCHAR(100) NOT NULL,
    audio_seconds DOUBLE PRECISION,         -- 服務計費的音檔長度；NULL＝沒回報（例如呼叫失敗）
    succeeded BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_transcription_usage_job_id ON transcription_usage(job_id);
CREATE INDEX ix_transcription_usage_user_id ON transcription_usage(user_id);

-- 收到 job.deleted 時記下（保留一天）：刪除之後才寫進來的資料要丟掉（見 docs/adr/0005）
CREATE TABLE deleted_jobs (
    job_id UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL
);
```

### 4.4 ai_db

**現況（已建立，二十四張表都在用）**：`pgvector` extension 有裝在 Postgres 上，`embeddings` 用
`BAAI/bge-m3`（1024 維，見 `ai-service/README.md`）：

```sql
-- id 由應用程式產生（uuid4），不靠資料庫預設值
CREATE TABLE summaries (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    summary_text TEXT,
    source_revision INT NOT NULL DEFAULT 0,  -- 依據的逐字稿 revision；小於逐字稿目前的 revision＝過時（章節共用）
    regeneration_status VARCHAR(10) NOT NULL DEFAULT 'IDLE',  -- 使用者要求的重新產生：IDLE / RUNNING / FAILED
    regeneration_requested_at TIMESTAMPTZ,   -- RUNNING 超過 5 分鐘視為卡住，允許再要求一次
    model_provider VARCHAR(32),              -- 產生它（與同一次的章節）的模型：platform 或廠商；記錄模型之前是 NULL
    model VARCHAR(200),
    created_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX ix_summaries_job_id ON summaries(job_id);

CREATE TABLE chapters (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    start_time NUMERIC(10,2) NOT NULL,
    sequence_no INT NOT NULL
);
CREATE INDEX ix_chapters_job_id ON chapters(job_id);

CREATE TABLE embeddings (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    chunk_text TEXT NOT NULL,                -- 一個（未清空的）片段；編輯後由 transcript.edited 個別更新
    start_time NUMERIC(10,2),
    end_time NUMERIC(10,2),
    embedding vector(1024) NOT NULL,         -- 依所選 embedding model 維度調整，目前用 1024
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX ix_embeddings_job_id ON embeddings(job_id);
-- ivfflat 向量索引還沒建：MVP 資料量小、查詢一定先用 job_id 過濾縮小範圍，先不做這層優化

CREATE TABLE qa_history (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source_timestamps NUMERIC(10,2)[] NOT NULL,
    model_provider VARCHAR(32),             -- 回答的模型：platform 或廠商；記錄模型之前是 NULL
    model VARCHAR(200),
    web_search BOOLEAN NOT NULL DEFAULT false, -- 這一題有沒有查網路（ai-service ADR 0014）
    web_sources JSONB NOT NULL DEFAULT '[]',   -- 回答依據的網路來源 [{title, url}]，順序是回答裡 [n] 的編號；搜尋失敗時是空的
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX ix_qa_history_job_id ON qa_history(job_id);

-- 用量：每一次 LLM 呼叫一筆（轉錄用量在 transcription_db）
CREATE TABLE llm_usage (
    id UUID PRIMARY KEY,
    user_id UUID,                           -- Job 擁有者 / 提問者；升級前排入的舊訊息沒有
    job_id UUID,                            -- 不屬於任何一個 Job 的呼叫（問決策跨 Job）是空的：算進使用者的月用量，不列在任何 Job 的用量裡
    feature VARCHAR(32) NOT NULL,           -- summary / chapters / qa_answer / qa_rewrite / regenerated_summary / regenerated_chapters / quiz / post_meeting / job_title / speaker_names / speaker_insights / generated_output / translation / decision_extraction / decision_qa / fact_check
    provider VARCHAR(32) NOT NULL,          -- platform 或廠商名稱
    model VARCHAR(200) NOT NULL,
    key_source VARCHAR(16) NOT NULL,        -- platform / own_key
    input_tokens INT,                       -- NULL＝廠商沒回報（未知），不是 0
    output_tokens INT,
    succeeded BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_llm_usage_job_id ON llm_usage(job_id);
CREATE INDEX ix_llm_usage_user_id ON llm_usage(user_id);

-- 講者名字建議：錄音裡明確講出身分的話（自我介紹、介紹下一位）給講者的名字與依據；使用者套用才改名（ai-service CONTEXT.md）
CREATE TABLE speaker_name_suggestions (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    speaker_label VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    evidence_start_time NUMERIC(10,2) NOT NULL, -- 依據那句話的片段開始時間
    evidence_text TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,            -- pending / applied / dismissed
    position INT NOT NULL,                  -- 講者順序，列出時照這個排
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_speaker_name_suggestions_job_id ON speaker_name_suggestions(job_id);

-- 網路搜尋的用量：問答每查一次網路一筆（量是次數，不是 token，所以不放在 llm_usage）；每月上限只算成功的
CREATE TABLE web_search_usage (
    id UUID PRIMARY KEY,
    user_id UUID,                           -- 提問者
    job_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,          -- 搜尋服務，例如 tavily
    succeeded BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_web_search_usage_job_id ON web_search_usage(job_id);
CREATE INDEX ix_web_search_usage_user_id ON web_search_usage(user_id);

-- 自有金鑰：每位使用者每個廠商一把，AES-256-GCM 加密（主金鑰在環境變數 KEY_ENCRYPTION_KEY，不在資料庫），
-- 見 ai-service/docs/adr/0005-own-api-keys-encrypted-in-ai-service.md
CREATE TABLE provider_keys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,          -- openai / anthropic / gemini / openrouter
    encrypted_key BYTEA NOT NULL,           -- nonce + 密文
    last4 VARCHAR(4) NOT NULL,              -- 給使用者辨認是哪一把；金鑰本身永遠不回傳
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_id, provider)
);

-- 預設模型：每位使用者一筆（沒有這一筆＝平台模型）；背景工作用它，問答可以在提問當下臨時換
CREATE TABLE default_models (
    user_id UUID PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,          -- 有自有金鑰的廠商
    model VARCHAR(200) NOT NULL,
    supports_tools BOOLEAN NOT NULL,        -- 選的時候確認過能不能呼叫工具（會後處理需要）
    updated_at TIMESTAMPTZ NOT NULL
);

-- 測驗：使用者要求產生的一份測驗（每次要求多一份），背景產生；GENERATING 超過 5 分鐘回報成 FAILED
CREATE TABLE quizzes (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,                  -- 要求產生的使用者（用他的預設模型、用量記在他名下）
    question_count INTEGER NOT NULL,        -- 5 / 10 / 20
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,                    -- 給使用者看的失敗原因
    source_revision INTEGER,                -- 依據的逐字稿 revision（完成後才有）
    model_provider VARCHAR(32),             -- 產生的模型（完成後才有）
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
CREATE INDEX ix_quizzes_job_id ON quizzes (job_id);

-- 測驗的題目：跟「完成」一起寫入
CREATE TABLE quiz_questions (
    id UUID PRIMARY KEY,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,              -- 從 1 開始
    kind VARCHAR(16) NOT NULL,              -- multiple_choice（4 個選項）/ true_false（「是」「否」）
    prompt TEXT NOT NULL,
    options TEXT[] NOT NULL,
    correct_option INTEGER NOT NULL,        -- 正確選項的位置（從 0 開始）
    explanation TEXT NOT NULL,
    source_timestamps DOUBLE PRECISION[] NOT NULL  -- 依據的片段開始時間（秒），一定對得到某個片段
);
CREATE INDEX ix_quiz_questions_quiz_id ON quiz_questions (quiz_id);

-- 作答：每次作答一筆（同一份測驗可以重做），後端計分；列表的最佳成績是答對題數的最大值
CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    answers INTEGER[] NOT NULL,             -- 依題目順序，每題選的選項位置（從 0 開始）
    correct_count INTEGER NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_quiz_attempts_quiz_id ON quiz_attempts (quiz_id);

-- 講者數據的 AI 判斷（每位講者提出的問題、可能的打斷）：一個 Job 一份，再分析完成才換掉項目
CREATE TABLE speaker_insights (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL UNIQUE,
    requested_by UUID NOT NULL,             -- 最近一次要求分析的使用者（他的預設模型、用量記在他名下）
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,
    source_revision INTEGER,                -- 上一次完成時依據的逐字稿 revision
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
CREATE TABLE speaker_insight_items (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES speaker_insights(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL,              -- question / interruption
    speaker_label VARCHAR(32) NOT NULL,
    interrupted_label VARCHAR(32),          -- 打斷時被打斷的講者
    start_time NUMERIC(10,2) NOT NULL,
    text TEXT NOT NULL                      -- 那個片段的原話
);

-- 已連結的帳號：使用者授權平台代他存取的 Google / Notion；權杖用自有金鑰那套 AES-GCM 加密，永遠不回傳前端
CREATE TABLE oauth_connections (
    user_id UUID NOT NULL,
    service VARCHAR(16) NOT NULL,           -- google / notion
    status VARCHAR(10) NOT NULL,            -- CONNECTED / INVALID（換不到新的存取權杖，要重新連結）
    encrypted_access_token BYTEA NOT NULL,
    encrypted_refresh_token BYTEA,
    expires_at TIMESTAMPTZ,                 -- 存取權杖到期的時間，快到期時用 refresh token 換新
    client_id VARCHAR(200) NOT NULL,        -- 換權杖、撤銷時要帶的 client（Notion 是動態註冊的那一個）
    connected_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, service)
);

-- 開始連結後、對方回呼前的授權：用 state 找回使用者，只能用一次、10 分鐘後作廢
CREATE TABLE oauth_pending_authorizations (
    state VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL,
    service VARCHAR(16) NOT NULL,
    redirect_uri TEXT NOT NULL,
    client_id VARCHAR(200) NOT NULL,
    browser_binding_hash VARCHAR(64) NOT NULL,  -- 瀏覽器 cookie 值的 SHA-256：回呼要帶回同一個值，state 才算數
    code_verifier VARCHAR(128),             -- PKCE（Notion）
    created_at TIMESTAMPTZ NOT NULL
);

-- 向 Notion 動態註冊的 client：每個回呼網址一個，重複使用
CREATE TABLE oauth_clients (
    service VARCHAR(16) NOT NULL,
    redirect_uri TEXT NOT NULL,
    client_id VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (service, redirect_uri)
);

-- 會後處理：使用者對一個 Job 手動啟動的 agent，一次一筆；「執行中」超過 5 分鐘回報成 FAILED（背景工作或下一次要求遇到時寫成 FAILED）
CREATE TABLE post_meeting_runs (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,                  -- 觸發的使用者（用他的預設模型與已連結的帳號、用量記在他名下）
    status VARCHAR(16) NOT NULL,            -- RUNNING / COMPLETED / LIMIT_REACHED（到了工具次數、模型呼叫次數或時間上限）/ FAILED
    progress TEXT NOT NULL,                 -- 執行中在做什麼（例如「正在查詢你的行事曆…」）
    failure_reason TEXT,
    timezone VARCHAR(64) NOT NULL,          -- 瀏覽器的時區，換算相對日期用
    uploaded_at TIMESTAMPTZ NOT NULL,       -- Job 建立（上傳）的時間，換算相對日期用
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,                 -- 這一次（重試也算新的一次）開始跑的時間；卡住從這裡算
    finished_at TIMESTAMPTZ
);
CREATE INDEX ix_post_meeting_runs_job_id ON post_meeting_runs (job_id);

-- 行動提案：agent 的寫入類工具不執行，只存成提案，等使用者確認（ai-service ADR 0007）
CREATE TABLE action_proposals (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES post_meeting_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    service VARCHAR(32) NOT NULL,           -- 例如 google_calendar
    tool VARCHAR(64) NOT NULL,              -- 確認後要呼叫的工具，例如 calendar_create_event
    kind VARCHAR(32) NOT NULL,              -- 例如 calendar_event，決定前端的表單
    arguments JSONB NOT NULL,               -- 要送出的參數；執行時換成使用者確認的最終參數
    status VARCHAR(10) NOT NULL DEFAULT 'PROPOSED',  -- PROPOSED（等確認）/ DONE / FAILED
    result_url TEXT,                        -- 執行成功時，建立好的項目的網址
    failure_reason TEXT,                    -- 執行失敗時給使用者看的原因（可以重試）
    executed_at TIMESTAMPTZ,
    fingerprint TEXT                        -- 執行成功時：服務|種類|正規化後的標題|時間，下一次認出同一件事（上次已建立）
);
CREATE INDEX ix_action_proposals_run_id ON action_proposals (run_id);

-- 會後處理的設定：Notion 會議紀錄位置（每場會議建成它底下的子頁面，含待辦清單；沒指定就不提 Notion 的寫入動作；改過的
-- 儲存前用 Notion MCP 確認是頁面，見 ai-service/docs/adr/0009）、待辦去處
CREATE TABLE post_meeting_settings (
    user_id UUID PRIMARY KEY,
    notion_meetings_page_id VARCHAR(64),       -- 每場會議的子頁面建在這個頁面底下
    notion_meetings_page_title TEXT,
    notion_meetings_page_url TEXT,
    todo_destination VARCHAR(20) NOT NULL DEFAULT 'google_tasks',  -- 待辦放在 google_tasks 或 notion（會議紀錄子頁面的打勾清單）
    updated_at TIMESTAMPTZ NOT NULL
);

-- 收到 job.deleted 時記下（保留一天）：刪除之後才寫進來的資料要丟掉（見 docs/adr/0005）
CREATE TABLE deleted_jobs (
    job_id UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL
);
```

譯文：一個 Job 一種語言一份，片段的譯文記著翻的時候的原文（變了就要重翻）：

```sql
CREATE TABLE translations (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    language VARCHAR(8) NOT NULL,           -- zh-TW / en / ja / ko
    requested_by UUID NOT NULL,             -- 最近一次要求翻譯的使用者（他的預設模型、用量記在他名下）
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,
    total_segments INTEGER NOT NULL DEFAULT 0,  -- 這次要翻的片段數（進度用）
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (job_id, language)
);
CREATE TABLE segment_translations (
    id UUID PRIMARY KEY,
    translation_id UUID NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
    segment_id UUID NOT NULL,               -- transcription-service 的片段 id
    source_text TEXT NOT NULL,              -- 翻的時候的原文
    text TEXT NOT NULL,
    UNIQUE (translation_id, segment_id)
);
```

決策紀錄：每個 Job 一份抽取紀錄，決策一筆一列（`user_id` 是 Job 擁有者，跨 Job 的時間軸、搜尋只查自己的）：

```sql
CREATE TABLE decision_extractions (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL UNIQUE,
    requested_by UUID NOT NULL,             -- 最近一次要求的使用者（自動抽是 Job 擁有者）
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,
    source_revision INTEGER,                -- 上一次完成的依據 revision（過時判斷）
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
CREATE TABLE decisions (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,
    statement TEXT NOT NULL,                -- 決定了什麼
    rationale TEXT NOT NULL DEFAULT '',     -- 為什麼（錄音裡講到的）
    alternatives JSONB NOT NULL DEFAULT '[]',  -- 考慮過但沒選的
    proposed_by VARCHAR(32),                -- 講者標籤（要是這個 Job 的講者）
    proposed_by_name VARCHAR(100),          -- 那位講者現在的名稱（跨 Job 的頁面用；transcript.edited 時跟著改）
    tentative BOOLEAN NOT NULL DEFAULT false,  -- 暫定
    start_time NUMERIC(10,2),               -- 做成決定的時間點（使用者新增的可以沒有）
    evidence_text TEXT,                     -- 那個片段的原話
    source VARCHAR(8) NOT NULL DEFAULT 'ai',   -- ai / user
    edited BOOLEAN NOT NULL DEFAULT false,  -- 使用者改過：重新抽時保留
    dismissed BOOLEAN NOT NULL DEFAULT false,  -- AI 抽的被使用者刪掉：不顯示，重新抽時同一個片段的不再收
    supersedes_id UUID REFERENCES decisions(id) ON DELETE SET NULL,  -- 取代了較早的哪一個
    embedding vector(1024),                 -- statement＋rationale
    source_revision INTEGER,
    meeting_at TIMESTAMPTZ,                 -- 會議的日期（Job 的上傳時間）：找較早的會議裡被取代的決策
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

事實查核：每個 Job 一筆標出主張的紀錄，主張一條一列，查核的結果記在那一條上：

```sql
CREATE TABLE fact_checks (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL UNIQUE,
    requested_by UUID NOT NULL,
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,
    source_revision INTEGER,
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
);
CREATE TABLE claims (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    speaker_label VARCHAR(32),
    start_time NUMERIC(10,2) NOT NULL,
    text TEXT NOT NULL,                     -- 那個片段的原話
    claim TEXT NOT NULL,                    -- 整理成一句完整、可以搜尋的陳述（查核時只送這一句）
    kind VARCHAR(8) NOT NULL,               -- number / fact
    verdict VARCHAR(24),                    -- supported / disputed / no_reliable_source / not_checkable；空的是還沒查
    explanation TEXT,
    sources JSONB NOT NULL DEFAULT '[]',    -- [{title, url, excerpt}]，順序就是說明裡 [n] 的編號
    checked_at TIMESTAMPTZ,
    check_model_provider VARCHAR(32),
    check_model VARCHAR(200),
    checking_since TIMESTAMPTZ,             -- 查核中
    check_error TEXT,                       -- 上一次查核失敗的原因（那一條保持還沒查）
    source_revision INTEGER,                -- 標出時的逐字稿 revision
    created_at TIMESTAMPTZ NOT NULL
);
```

多格式輸出（原本規劃叫 `export_outputs`，改名避免跟「匯出」混淆；同一種格式可以有很多份，沒有 UNIQUE）：

```sql
CREATE TABLE generated_outputs (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,                  -- 要求產生的使用者（他的預設模型、用量記在他名下）
    format VARCHAR(32) NOT NULL,            -- podcast_description / youtube_description / blog_post / newsletter / social_post
    options JSONB NOT NULL DEFAULT '{}',    -- Job 的標題、使用者的一句要求、社群貼文的平台
    status VARCHAR(10) NOT NULL,            -- GENERATING / COMPLETED / FAILED
    failure_reason TEXT,
    content TEXT,                           -- Markdown；章節時間由程式附上，模型寫的時間會被刪掉
    source_revision INTEGER,
    model_provider VARCHAR(32),
    model VARCHAR(200),
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    edited_at TIMESTAMPTZ                   -- 使用者改過內容的時間
);
CREATE INDEX ix_generated_outputs_job_id ON generated_outputs (job_id);
```

---

## 5. 訊息佇列設計（MQ Topics/Queues）

| Queue/Topic | Producer | Consumer | Payload |
|---|---|---|---|
| `transcription.requested` | Upload Service | Transcription Service | `{ jobId, userId, storagePath, fileType, transcriptionLanguage }`——`userId` 是 Job 擁有者，一路帶到 ai-service，用量記在他名下；`transcriptionLanguage` 是上傳時選的轉錄語言（`zh-TW` / `en` / `auto`，舊訊息沒有當成中文，見 `transcription-service/docs/adr/0002-transcription-language-chosen-at-upload.md`） |
| `transcription.completed` | Transcription Service | AI Service | `{ jobId, userId }`（`userId` 原樣從 `transcription.requested` 帶過來；升級前排入的舊訊息沒有，照常處理，用量不記使用者） |
| `ai.completed` | AI Service | Notification Service | `{ jobId, status }` |
| `job.failed` | 任一服務 | Notification Service | `{ jobId, stage, errorReason }` |
| `summary.regeneration.requested` | AI Service | AI Service | `{ jobId, userId }`（`userId` 是要求重新產生的使用者）——使用者要求重新產生摘要與章節（`POST /summary/{jobId}/regenerate`）；ai-service 排給自己的背景工作，不動 Job 狀態 |
| `translation.requested` | AI Service | AI Service | `{ jobId, language }`——使用者要求翻譯逐字稿（`POST /jobs/{jobId}/translations`）；ai-service 排給自己的背景工作，一批一批翻、每批存檔 |
| `fact_check.requested` | AI Service | AI Service | `{ jobId, userId }`——使用者要求標出可以查核的主張（`POST /jobs/{jobId}/fact-check`）；ai-service 排給自己的背景工作 |
| `decision.requested` | AI Service | AI Service | `{ jobId, userId, meetingAt }`（`meetingAt` 是 Job 的上傳時間，找較早的會議裡被取代的決策用）——使用者要求抽出決策（`POST /jobs/{jobId}/decisions/extract`），或會議、訪談轉錄完由 pipeline 自動要求（`userId` 是 Job 擁有者）；ai-service 排給自己的背景工作 |
| `output.requested` | AI Service | AI Service | `{ outputId, jobId, userId }`——使用者要求產生一份多格式輸出（`POST /jobs/{jobId}/outputs`）；ai-service 排給自己的背景工作 |
| `speaker_insights.requested` | AI Service | AI Service | `{ jobId, userId }`——使用者要求分析講者的問題與打斷（`POST /jobs/{jobId}/speaker-insights`）；ai-service 排給自己的背景工作 |
| `quiz.requested` | AI Service | AI Service | `{ quizId, jobId, userId }`（`userId` 是要求產生的使用者）——使用者要求產生測驗（`POST /jobs/{jobId}/quizzes`）；ai-service 排給自己的背景工作 |
| `post_meeting.requested` | AI Service | AI Service | `{ runId, jobId, userId }`（`userId` 是觸發的使用者）——使用者啟動會後處理（`POST /jobs/{jobId}/post-meeting`）；ai-service 排給自己的背景工作 |
| `transcript.edited` | Transcription Service | AI Service | `{ jobId }`——使用者編輯逐字稿後發出；ai-service 回頭讀逐字稿、只重算文字有變的片段的 embedding，翻好的譯文只重翻文字有變的片段，決策存的提出者名稱跟著講者改名（見 `docs/adr/0003-transcript-edits-propagate-via-mq-event.md`） |
| `account.deleted`（**fanout exchange**） | Auth Service（outbox） | Upload Service（`account.deleted.upload`）、AI Service（`account.deleted.ai`）、Transcription Service（`account.deleted.transcription`） | `{ userId }`——使用者刪除了帳號：upload-service 刪掉他所有的 Job（每個再發 `job.deleted`），ai-service 撤銷並刪掉已連結的帳號、自有金鑰與個人設定，兩個服務把用量去識別化（`user_id` 設 NULL） |
| `job.deleted`（**fanout exchange**） | Upload Service（outbox） | Transcription Service（`job.deleted.transcription`）、AI Service（`job.deleted.ai`） | `{ jobId, userId }`——Job 刪掉了，各服務清掉自己手上這個 Job 的資料（用量不刪）；見 `docs/adr/0005-deletion-events-fan-out-through-an-outbox.md` |

**實作現況**：實際用的是 **RabbitMQ**（不是原規劃的 Redis Queue），上表 queue 的名稱/payload
都跟實作一致，`job.failed` 目前由 transcription-service、ai-service 各自在 pipeline 失敗時發送。
ai-service 消費的每個 queue 各有一組自己的 retry queue（`<queue>.retry.2s`／`.4s`，見 ai-service ADR 0001）。
刪除事件不一樣：一個事件要給好幾個服務，所以發到 fanout exchange、每個服務綁自己的佇列；發送經過 upload-service 的 outbox
（跟刪除同一個交易），處理失敗不限次數地 30 秒後重試（`<queue>.retry`），見 `docs/adr/0005-deletion-events-fan-out-through-an-outbox.md`。
Redis 不當訊息佇列，改用在 gateway 的限流（每個 API 請求與登入、註冊的計數器，見 `gateway/README.md`「限流」）與 cache-aside
的快取（gateway 的 Job 擁有者，見 `gateway/README.md`「快取」；transcription-service 的逐字稿，見 `transcription-service/README.md`
「逐字稿快取」）；Redis 連不上時都照常服務（限流放行、快取當作沒記住）。

---

## 6. 技術棧總覽

| 分類 | 技術選擇 |
|---|---|
| API Gateway | Spring Boot（Web MVC）+ gRPC Client——手刻 REST controller 轉呼叫下游 gRPC，不是 Spring Cloud Gateway |
| 商業邏輯服務（Auth/Upload） | Spring Boot + gRPC Server，無對外 REST |
| ASR / AI 服務 | Python + gRPC Server（`grpc.aio`/health/reflection）＋獨立 thread 跑 pika 消費 MQ，不是 FastAPI |
| 即時通訊服務（Notification） | Python + FastAPI（純 WebSocket + `/health`）+ pika 消費 MQ |
| 服務間同步呼叫 | gRPC（proto 定義在 `infra/proto/`），Gateway 是唯一對外 REST facade |
| 前端 | React |
| 關聯式資料庫 | PostgreSQL（各服務獨立 schema，Java 用 Hibernate `ddl-auto=update`；Python 服務用 SQLAlchemy + Alembic migration） |
| 向量資料庫 | pgvector（`ai_db.embeddings`，`BAAI/bge-m3` 1024 維，已在用） |
| 物件儲存 | MinIO（本機開發）／ Cloudflare R2（正式環境，尚未設定） |
| 訊息佇列 | **RabbitMQ**（實際採用，非原規劃的 Redis Queue；Redis 改用在 gateway 的限流與快取、transcription-service 的逐字稿快取） |
| ASR + 講者分離 | Deepgram Nova-3（`zh-TW`，一次呼叫完成轉錄與講者分離，僅 transcription-service 使用；取代原本的 Groq Whisper，見 `transcription-service/docs/adr/0001-deepgram-replaces-groq-for-transcription-and-diarization.md`）；中文逐字稿存檔前用 OpenCC（`s2tw`，只換字形不換詞）轉成繁體；ai-service 也用它把整段寫成簡體的問答回答與測驗轉成繁體（本機小模型偶爾會） |
| LLM（摘要/章節分段/RAG 問答） | 透過 OpenAI 相容介面呼叫（見 `ai-service/docs/adr/0004-generation-calls-through-openai-compatible-interface.md`），用使用者的預設模型（問答可以臨時換成別的模型）：平台模型，或使用者自有金鑰的 OpenAI／Anthropic／Google Gemini／OpenRouter 模型（金鑰加密存放，見 `ai-service/docs/adr/0005-own-api-keys-encrypted-in-ai-service.md`）。平台模型預設是 HF Inference Providers 的 OpenAI 相容路由（`PLATFORM_LLM_BASE_URL` 可以改指向任何 OpenAI 相容的伺服器：本機開發用 Docker 跑的 Ollama，一般生成與會後處理都用 `qwen3:14b`（見 `ai-service/docs/adr/0011-local-post-meeting-model-qwen3-14b.md`），上雲可以用自架 vLLM 或其他託管 API，見 `infra/README.md`）（`Qwen/Qwen3.5-9B`；原規劃/早期實作用 Gemini API 之後改 Groq，Groq 免費層 TPM 太小、加上對話記憶後很容易超過，已改用 HF Inference Providers，見 `ai-service/README.md`、`ai-service/docs/adr/0003-hf-inference-providers-for-generation.md`） |
| Embedding | HF Inference Providers（`BAAI/bge-m3`，1024 維） |
| 網路搜尋（問答「查網路」） | Tavily 官方遠端 MCP（`tavily_search`，平台付費的 `TAVILY_API_KEY`；由系統在回答前查一次，不給模型工具；只送出一句搜尋查詢，見 `ai-service/docs/adr/0014-qa-web-search-by-the-system.md`） |
| 已連結的帳號（會後處理用） | Google OAuth（平台自己的 OAuth client，只要 Calendar 活動、Gmail 建立草稿、Tasks 的權限）與 Notion 官方遠端 MCP 的 OAuth（PKCE + 動態註冊 client）；權杖用自有金鑰那套 AES-GCM 加密存在 ai-service，state 綁定開始連結的瀏覽器（見 `ai-service/README.md`「已連結的帳號」） |
| 容器化 | Docker；本機有兩種跑法——`docker-compose`（只跑基礎設施，服務在 host 上跑）或 **Kubernetes**（`infra/k8s/`，完整六服務 + 基礎設施都在叢集內，本機用 Docker Desktop 內建 kind）。細節見 `infra/README.md` |
| 即時通訊 | WebSocket（Notification Service，路徑 `/ws/jobs/{jobId}`） |

---

## 6.5 雲端免費部署方案（MVP 上雲用，規劃中，尚未執行）

> 這節整節都是**還沒做**的規劃，目前實際只有本機部署（docker-compose 或本機 k8s/kind，見上表與
> `infra/README.md`），沒有任何服務真的跑在下面列的雲端平台上。保留內容作為之後要上雲時的參考。

MVP 階段先用免費額度上雲驗證，不用信用卡。以下是各服務對應的免費雲端選項與限制備註，正式流量成長後需個別評估升級。

| 用途 | 推薦服務 | 免費額度 | 限制備註 |
|---|---|---|---|
| **後端服務託管**（core-service / transcription-service / ai-service） | **Render** | 每月 750 小時免費 Web Service（512MB RAM、0.1 CPU） | 15 分鐘無流量會自動休眠，冷啟動約 30-60 秒；免費層不支援水平擴展、無 SSH/shell 存取；僅適合 MVP 測試，非正式生產環境 |
| **PostgreSQL + 向量資料庫** | **Supabase** | 免費層 500MB 儲存空間；pgvector 在所有方案（含免費）都開放使用 | 超過 500MB 需升級付費方案；免費層資料庫有閒置自動暫停機制，需注意喚醒延遲 |
| **Redis**（gateway 的限流計數與快取、transcription-service 的逐字稿快取；訊息佇列實際用 RabbitMQ；上限 256MB、滿了淘汰最久沒用的） | **Upstash** | 每月 50 萬次指令、256MB 資料量，按需計費（Serverless） | 超過額度需升級；限流讓每個 API 請求都要 1～2 個指令（登入、註冊更多），每個 Job 的請求再加 1 個查快取，每次讀逐字稿再加 1～2 個，要留意用量 |
| **物件儲存**（音訊/影片檔案） | **Cloudflare R2** | 10GB 儲存空間、每月 100 萬次操作 | 超過額度另計費；免費層無 CDN 加速額外保證，大流量下載需注意頻寬成本 |
| **前端託管** | **Vercel** 或 **Cloudflare Pages** | 個人專案額度足夠，無需信用卡 | 商業用途需確認條款（Vercel 免費層條款僅限個人/非商業用途，正式商用需留意） |
| **ASR + 講者分離（transcription-service）** | **Deepgram Nova-3** | 新帳號一次性 $200 額度（不用綁卡），講者分離不另外收費；之後 $0.0043/分鐘 | 額度是一次性的，不像 Groq 每天重置，用完就要付費（約 775 小時音訊）；額度監控仍是缺口（見 7. 第 7 點） |
| **LLM（摘要/章節分段/問答，ai-service）** | **HF Inference Providers** | 依 provider 而定，沒有像 Groq 那樣公開逐模型的固定數字 | 免費額度會隨政策調整而變動，需定期查閱官方文件確認當下額度；特定模型是否有 provider 承載也會隨時間變動，換模型前建議先查（見 `ai-service/README.md` 已知限制） |
| **網路搜尋（ai-service，問答「查網路」）** | **Tavily** | 整個平台每月 1,000 credits（一般搜尋 1 credit／次），不用綁卡；之後 US$0.008／credit | 額度是整個平台共用，不是每位使用者；每人每月的搜尋次數有用量上限（預設 30 次，只算成功的，見 gateway README「每月用量上限」） |
| **Embedding（ai-service）** | **HF Inference Providers** | 依 provider 而定，一般有免費額度，無需信用卡即可申請 | 特定模型是否有 provider 承載會隨時間變動，需留意 |

**額度風險提醒**
- 免費層額度通常是「組織/帳號」層級，不是「API Key」層級，開多組 Key 不會疊加額度
- 建議在 `ai-service` 和 `transcription-service` 都做好 429（Too Many Requests）重試與告警機制，避免額度用盡時整條 pipeline 卡死卻沒有任何提示
- Render 免費層的休眠機制會讓使用者第一次連線時等待 30-60 秒，MVP 測試階段可接受，但要事先跟測試者說明，避免誤以為服務掛掉

**建議組合**：Render（3 個後端服務）+ Supabase（Postgres + pgvector）+ Upstash（Redis）+ Cloudflare R2（檔案儲存）+ Vercel（前端），全部組合都不需要信用卡即可開始。

**前端與 API 要同一個網站**：refresh token 的 cookie 是 `SameSite=Strict`（見 3.1），`*.vercel.app` 的前端直接呼叫 `*.onrender.com` 的 gateway
是兩個不同網站，cookie 不會送出、重新整理頁面就被登出。做法：用 Vercel 的 rewrites 把 `/api/*` 轉到 gateway（瀏覽器看來是同源），
或兩邊都掛在自己的網域底下（例如 `app.example.com` 與 `api.example.com`，並調整 `REFRESH_COOKIE_PATH`）。notification-service 的
WebSocket 不靠 cookie（連上後送 access token，見 3.5），可以照樣直連。

---

## 7. MVP 階段簡化建議

1. **服務註冊/發現**：沒用 Consul/Eureka，靠固定 service name 解析——本機用 docker-compose 內部
   網路，k8s 部署則靠 namespace 內的 Service DNS（見 `infra/k8s/01-configmap.yaml` 的
   `*_GRPC_TARGET` 設定），兩種模式殊途同歸，都不需要額外的服務發現元件
2. **訊息佇列**：實際採用 RabbitMQ（不是原規劃的 Redis Queue，見 5./6. 節），producer/consumer
   沒有額外抽象一層 interface，各服務直接用 pika（Python）/ Spring AMQP（Java）。三個 Python
   consumer（ai-service/transcription-service/notification-service）連線斷線時有指數退避自動
   重連；upload-service（唯一的 producer-only 服務）用 Spring AMQP 的 `RabbitTemplate` 發送重試
3. **講者分離**：轉錄時自動做（Deepgram，講者依第一次開口的順序編號為「講者 N」），來源欄有講者區塊（每位講者一個顏色，可以就地改名），逐字稿在換人的地方顯示講者，片段可以改成別的講者或新增講者（修正分離錯誤），迷你播放器與匯出帶講者名稱，AI 的摘要 / 章節 / 問答知道誰說了什麼（問答在回答當下才用講者目前的名字，改名不用重算 embedding）；只有一位講者時全部隱藏、AI 輸入也不帶名字；舊 Job 不回填
4. **多格式輸出**：Studio「多格式輸出」產生 Podcast 介紹、YouTube 描述、部落格文章、電子報、社群貼文（依平台），依摘要、章節與使用者取過名字的講者寫成 Markdown，可以複製、下載。「會議紀錄」不另外做——會後處理寫進 Notion 的會議紀錄就是它。
   不要跟已經做好的「匯出」（前端把既有內容轉成 TXT/SRT/VTT/Markdown（報告、測驗），含譯文與雙語字幕、複製、下載原始檔）混為一談
5. **Auth**：JWT（HS256，access 15 分鐘/refresh 7 天），refresh token 存雜湊、可輪替與作廢（登出、被盜偵測），不做完整 OAuth2 flow
6. **可觀測性**：只有基本 log（Python 用標準 `logging`，Java 用 Spring 預設），沒有 tracing（Sleuth/Zipkin 等待流量成長後再導入）
7. **免費 API 額度管理**：AI Service 呼叫 HF Inference Providers（摘要/章節分段/RAG 問答/embedding）、Transcription Service 呼叫 Deepgram 時遇到 429/5xx/逾時，**已解決**——兩邊都用同一套訊息層級 requeue 機制自動重試（TTL + dead-letter-exchange，最多 2 次、共 3 次嘗試，見 `ai-service/docs/adr/0001-message-level-retry-for-transient-external-failures.md`，`ai-service`/`transcription-service` 的 `app/services/retry.py` 是實際實作）；這跟上面第 2 點的 MQ **連線**重試是不同層級，兩層現在都做了。AI Service 額外把同一套機制套用到內部 gRPC 呼叫（transcript-fetch、mid-pipeline 狀態回報），也補上了終端失敗回報（`UpdateJobStatus(FAILED, ...)`）本身失敗時的獨立重試；Transcription Service 目前只做了語音辨識呼叫這一段，gRPC 呼叫韌性跟終端失敗回報重試還沒跟進（見 `transcription-service/README.md` 已知限制）。用量已記錄（每一次 LLM 呼叫與轉錄都記在使用者與 Job 名下，Job 工作區逐筆列出、設定頁看得到每月依模型加總）；每位使用者每月有用量上限（轉錄分鐘數、平台模型 token，見 `gateway/README.md`「每月用量上限」），用量告警仍是缺口
8. **正式環境的設定**：每個服務讀 `APP_ENV`（預設 `development`）；`production` 時啟動前檢查自己的密鑰（沒設、還是開發用預設值、或太短就不啟動，並說出是哪幾個環境變數），並關掉開發用的東西（gRPC reflection、gateway 與 notification-service 的 API 文件）。要換掉哪些值見 `infra/k8s/02-secret.yaml`，Redis 在正式環境要設密碼（`REDIS_PASSWORD`）。
9. **依賴套件弱點掃描**：每個服務的 README 有「依賴套件弱點掃描」一節寫怎麼掃（Python：pip-audit；Java：用 Grype 掃 build 出來的 jar；前端：`npm audit`），上線前與之後每個月跑一次。2026-10-03 掃過一輪，高風險／嚴重的都升級或覆蓋版本修掉了（Spring Boot 4.1.0 → 4.1.1 加上 Jackson、Tomcat、amqp-client 的版本覆蓋；transcription-service 的 pillow、urllib3；前端 `npm audit fix`），只剩前端開發工具（shadcn CLI）裡一個還沒有修好版本、也不會進到瀏覽器的 `braces`（見 `frontend/README.md`）。只掃了語言套件，container image 的作業系統套件還沒掃
10. **刪除帳號與揭露**（個資法）：使用者可以在設定頁刪除帳號（再輸入密碼），所有資料刪除、已連結帳號撤銷授權、用量去識別化（見 3.1、5.）；
    前端 `/privacy` 列出每個第三方送什麼、什麼時候送（註冊頁與設定頁連過去）。隱私權說明還是草稿：聯絡 email、伺服器地區待補，上線前請懂法的人看過

---

## 8. 待確認事項（開發前建議先想清楚）

- [x] 30 分鐘音訊限制是否要做「檔案大小」而非「時長」的替代限制——**已解決**：不是二選一，兩者對應不同的東西，分開處理（見 `upload-service/docs/adr/0001-upload-size-limit-is-file-type-aware.md`）。時長限制（30 分鐘，前端強制）維持現狀，是獨立的 MVP 產品決策，當時也是 VIDEO 上傳唯一有意義的 Groq 相關把關（VIDEO 原始檔案大小含容器/畫面編碼開銷，不等於最終送進 Groq 的音軌大小）。新增兩層後端強制的大小限制：AUDIO 專用上限（20MB，當時對齊 Groq 免費層）跟不分類型的濫用防護上限（1GB）——過去這兩層完全沒有後端驗證，`file_size_bytes` 只檢查是否為正數，繞過前端就能上傳任意大小。`GetPresignedUploadUrl` 用呼叫端回報的大小做早期擋檢查，`CompleteUpload` 改問物件儲存實際存了多大（不信任呼叫端回報的數字），超過限制立即刪除物件。語音辨識已從 Groq 換成 Deepgram（沒有 25MB 上限），2026-09-28 兩個限制一起放寬、抓在大約 1 小時：時長 60 分鐘、AUDIO 上限 120MB，1GB 的濫用防護上限不變（見 upload-service ADR 0001 的修訂）。
- [x] embedding model 選擇——**已解決**：`BAAI/bge-m3`（透過 HF Inference API），1024 維，
      query/document 對稱不用加 instruction 前綴；選型過程見 `ai-service/README.md` 已知限制
      （HF Inference Providers 當下有沒有 provider 實際托管該模型會隨時間變動，換模型前建議先查）
- [x] 章節自動分段的演算法/prompt 設計——**已解決**：純 LLM 判斷（把逐字稿片段連同時間戳丟給
      HF Inference Providers 的聊天模型，要求回傳 JSON 章節列表），沒有搭配語音停頓偵測，見
      `ai-service/app/services/chapter_generator.py`
- [x] 多格式輸出的模板內容——**已解決**：每種格式一份 prompt（`ai-service/app/services/output_generator.py`），只根據摘要與章節、不編造、不寫時間（章節時間由程式附上）
- [ ] Google 的權限審查——連結 Google 帳號已實作，但 `gmail.compose`（建立草稿）是 Google 的受限權限，通過 Google 的
      應用程式審查之前只有同意畫面登記的測試使用者能連結，還沒申請；Notion 已經用真的帳號走過一次（2026-09-28），但回應的
      格式沒有正式文件（標題、建立好的網址是寬鬆地從回應裡找出來的）
      （見 `ai-service/README.md` 已知限制）。Google 日曆與 Gmail 不用官方的遠端 MCP（預覽計畫 GA 前不能開放給網域外的
      使用者），會後處理改用自己寫的 REST API 工具（見 `ai-service/docs/adr/0006-post-meeting-agent-model-and-google-tools.md`）
- [x] 會後處理的平台模型——**已決定**：改成部署設定、預設不提供（`ai-service/docs/adr/0008-configurable-post-meeting-platform-model.md`，
      局部取代 0006）。原本的結論是不提供：實測最好的免費選擇 Groq `openai/gpt-oss-120b` 在免費層額度不夠（一次要等 3～5 分鐘、
      全平台一天 3～4 次），付費層決定不開。現在可以設 `AI_POST_MEETING_PLATFORM_MODEL`（例如 HF 上的 `Qwen/Qwen3.8-27B:deepinfra`，
      一次約 US$0.02，費用算在平台的 HF 金鑰）；沒設定時仍只能用自有金鑰、支援工具呼叫的模型。平台模型的用量受每月用量上限管（見 `gateway/README.md`）
- [x] 使用者刪除 Job 時是否連帶清除物件儲存檔案——**部分解決**：`UploadService.DeleteJob` 會嘗試刪除
      對應的物件儲存檔案，刪除失敗只記警告不擋 Job 刪除（優先保證使用者的刪除意圖，孤兒物件之後
      靠背景清理排除）。transcription_db／ai_db 的資料由 `job.deleted` 事件清掉（2026-10-03，見 5.）：逐字稿、片段、講者、
      摘要、章節、embedding、問答、測驗、講者名字建議、講者數據的問題與打斷、決策（別的 Job 取代它的連結跟著消失）、事實查核的主張、多格式輸出、譯文、會後處理；用量紀錄保留。刪除當下還在跑的寫入晚到也會被丟掉
- [x] 授權缺口：使用者只能存取自己的 job——**已解決**：Gateway 在轉發 Transcription/AI 的查詢
      前先呼叫 upload-service 的 `GetJob` 做 ownership 檢查（見 2.1），但 transcription-service /
      ai-service 本身仍不驗證 `x-user-id`，這個決定維持不變（見 2.1 授權模型）

## 8.5 未來規劃（尚未實作）

以下是原本規劃、但目前程式碼裡完全沒有對應實作的功能，列出來避免跟「現況」搞混：

- **雲端部署**（Render/Supabase/Upstash/R2/Vercel，見 6.5）：規劃內容保留，尚未真的部署上去
- **`x-user-id` 下游驗證**：transcription-service/ai-service 本身仍不驗證這個 header，ownership 檢查目前只在 Gateway 這一層做（見 2.1）——刻意維持的設計決定，不是還沒做
