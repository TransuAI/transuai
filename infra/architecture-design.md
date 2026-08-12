# 音訊/影片逐字稿 + AI 分析平台 — 架構規劃文件

## 1. 系統概觀

### 1.1 產品定位
使用者上傳音訊/影片（MVP 階段限制 30 分鐘），系統自動產出逐字稿，並提供 AI 摘要、問答、多格式輸出等功能。差異化重點：

- **時間戳記精準跳轉問答**：AI 回答附上時間戳，可直接跳轉播放對應片段
- **一鍵生成多格式輸出**：依場景輸出會議紀錄（待辦事項+負責人+期限）、Podcast 節目介紹、YouTube 描述、社群貼文草稿
- **章節自動分段**：偵測話題轉換點，自動產出章節標題

### 1.2 核心資料流（非同步 Pipeline）

```
使用者上傳音訊/影片
  → Upload Service：存檔到物件儲存，寫入 Job record（status: pending）
  → 發送訊息「轉錄請求」到 MQ

Transcription Service 消費訊息
  → 抽音軌（若為影片，用 FFmpeg）
  → 呼叫 Groq Whisper API 轉錄（含 timestamp）
  → 更新 Job status: transcribing → transcribed
  → 逐字稿存入 DB（含分段 timestamp）
  → 發送訊息「轉錄完成」到 MQ

AI Service 消費訊息
  → 讀取逐字稿，呼叫 Gemini API 產出摘要
  → 更新 Job status: summarizing → completed
  → 發送訊息「處理完成」到 MQ

Notification Service 消費訊息
  → 透過 WebSocket 推播給前端，更新使用者介面
```

> **實作現況**：目前只做到「摘要」這一步。embedding/pgvector、RAG 問答、自動章節分段、
> 多格式輸出都還沒實作（`ai_db` 也只建了 `summaries` 一張表），下面規劃內容保留作為
> 未來擴充方向，不代表現在能動。見 [8.5 未來規劃（尚未實作）](#85-未來規劃尚未實作)。

---

## 2. 服務拆分

| 服務 | 職責 | 技術棧 | 對外/對內 |
|---|---|---|---|
| **API Gateway** | 統一入口、JWT 本地驗證、REST↔gRPC 轉譯 | Spring Boot（Web MVC）+ gRPC Client | 對外 |
| **Auth Service** | 使用者註冊/登入、JWT 簽發與刷新 | Spring Boot + gRPC Server | 對內（僅供 Gateway 呼叫） |
| **Upload Service** | 檔案上傳、產生 presigned URL、Job 建立與狀態管理 | Spring Boot + gRPC Server | 對內（僅供 Gateway / 下游服務呼叫） |
| **Transcription Service** | 抽音軌（moviepy/ffmpeg）、呼叫 Groq Whisper、逐字稿產出與儲存 | Python + gRPC Server | 對內（MQ 驅動，查詢走 gRPC） |
| **AI Service** | 摘要生成（MVP 範圍，見上方實作現況） | Python + gRPC Server | 對內（MQ 驅動，查詢走 gRPC） |
| **Notification Service** | Job 狀態即時推播 | Python + FastAPI（WebSocket）+ pika | 對內（WebSocket 對外） |
| **Frontend** | 使用者介面、播放器、時間戳跳轉 | React | 對外 |

> **技術棧更正**：API Gateway 不是用 Spring Cloud Gateway 的宣告式路由，是一般 Spring Boot Web MVC
> 應用，手刻 REST Controller，內部用 gRPC client 呼叫下游服務——本質上是個 REST↔gRPC 轉譯層。
> 除了 Gateway 以外的五個服務都**沒有對外 REST API**，彼此/對 Gateway 一律走 gRPC（同步查詢）
> 或 RabbitMQ（非同步事件），Notification Service 是唯一例外（WebSocket 直接對外）。

### 2.1 服務邊界原則（Database per Service）

每個服務各自擁有獨立 schema，不可直接跨服務查表：

- `auth_db`：使用者帳號（目前只有 `users` 一張表，JWT 是 stateless，沒有 refresh token 儲存表）
- `upload_db`：檔案 metadata、Job 狀態機
- `transcription_db`：逐字稿內容、分段 timestamp
- `ai_db`：摘要結果 + 章節分段（目前有 `summaries` / `chapters` 兩張表，embedding/QA/多格式輸出的表都還沒建，見 8.5）

跨服務資料需求（例如前端要同時顯示 Job 狀態 + 逐字稿 + 摘要）完全由 **Gateway 做 API Composition**：
Gateway 收到 REST 請求後呼叫對應下游服務的 gRPC API，把結果轉成 JSON 回傳，下游服務之間除了
MQ 事件外互不直接呼叫，也不會有即時跨庫 join。

> **授權模型**：transcription-service / ai-service 本身**不驗證 `x-user-id`**，只信任「呼叫方是
> 內部網路」（見兩邊 proto 的註解）——這點沒變，MVP 階段不打算讓每個下游服務各自重新實作一次
> ownership 邏輯。實際的「只能存取自己的 job」檢查現在收斂在 Gateway 這一層：轉發
> `GetTranscript`/`GetSummary`/`ListChapters` 前，Gateway 會先呼叫 upload-service 的 `GetJob`
> 確認這個 job 是不是目前使用者的（`gateway/src/main/java/.../grpc/JobOwnershipGuard.java`），
> 不是就回 404，不會再往下游打。代價是每個請求多一趟內部 gRPC 往返。這個檢查只存在於走 Gateway
> 的路徑——如果之後有服務直接繞過 Gateway 打 transcription-service/ai-service，還是能查到任意
> job，這種情境目前假設不存在（下游服務只監聽 cluster 內部網路）。

---

## 3. API 設計

以下都是 **Gateway 對外的 REST API**（實際協定見上方 2 節：Gateway 內部呼叫下游服務一律走 gRPC，
proto 定義在 `infra/proto/*.proto`）。下游服務本身沒有對外 REST endpoint。

### 3.1 Auth Service

```
POST   /auth/register          註冊（email 已存在回 409/ALREADY_EXISTS，成功直接簽發 token，不用再呼叫一次 login）
POST   /auth/login             登入，回傳 access/refresh token（email/password 任一錯誤都回 401，不細分以避免帳號列舉）
POST   /auth/refresh           用 refresh token 換發新的 access/refresh token 組合
GET    /auth/me                取得目前使用者資訊（需帶 access token）
```

**JWT 機制**：HMAC（HS256/HS384，視 secret 長度而定）簽章，`JWT_SECRET` 由 auth-service 與
gateway 共用同一把。access token 15 分鐘、refresh token 7 天過期（皆可透過
`app.jwt.access-token-ttl-minutes` / `app.jwt.refresh-token-ttl-days` 覆蓋）。**是 stateless
JWT，沒有 server-side 的 revocation list**——auth-service 不儲存 refresh token，`/auth/refresh`
純粹是驗證簽章/過期時間/`type=refresh` claim 後重新簽發，代表 refresh token 洩漏或使用者「登出」
都無法讓舊 token 失效，只能等它自然過期。Gateway 收到請求後在本地驗證 access token（不會回頭呼叫
auth-service 確認），驗證通過後把 user id 透過 gRPC metadata `x-user-id` 轉發給下游服務。

### 3.2 Upload Service

```
POST   /uploads/presign         取得物件儲存的 presigned upload URL（尚未建立 Job）
POST   /uploads/complete        前端上傳完成後呼叫，建立 Job record 並發送 transcription.requested 事件
GET    /jobs/{jobId}            查詢單一 Job 狀態與基本資訊
GET    /jobs                    查詢使用者所有 Job（分頁，query: page, pageSize）
DELETE /jobs/{jobId}            刪除 Job 與相關資料
```

Job 狀態機：
```
pending → uploading → uploaded → transcribing → transcribed
  → summarizing → completed
  （任一階段失敗 → failed，記錄 error reason）
```

### 3.3 Transcription Service

```
GET    /transcripts/{jobId}            取得逐字稿全文（含分段 timestamp）
GET    /transcripts/{jobId}/segments   取得分段列表（用於前端字幕同步捲動）
```

底層對應 gRPC 只有一支 `GetTranscript`（查詢用），兩個 REST endpoint 都是 Gateway 呼叫同一支
RPC 後，視需要只回傳 `segments` 欄位。轉錄本身完全是 **MQ 驅動**（消費 `transcription.requested`），
沒有另外開一支「觸發轉錄」的 API。

逐字稿回傳格式範例：
```json
{
  "jobId": "uuid",
  "language": "zh-TW",
  "segments": [
    { "start": 12.3, "end": 15.8, "speaker": null, "text": "今天想聊的主題是..." }
  ],
  "fullText": "..."
}
```

### 3.4 AI Service

```
GET    /summary/{jobId}                 取得摘要
GET    /chapters/{jobId}                取得章節列表
```

`chapters` 對應 ai-service 的 gRPC `ListChapters`（已實作，見 `ai-service/README.md`），但 Gateway
這邊還沒加對應的 REST endpoint 轉譯，目前只有 gRPC 這一層可以查。原規劃的問答/多格式輸出 API
（見下方 8.5）還沒實作。

### 3.5 Notification（WebSocket，Gateway 不經手，前端直連 notification-service）

```
WS     /ws/jobs/{jobId}         訂閱單一 Job 的狀態更新事件
```

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
> 自動建表，Python 服務由 SQLAlchemy `create_all` 依 model 自動建表，這裡列出的 SQL 是對應內容，
> 不是手寫 migration）。

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

只有這一張表，**沒有 refresh token 儲存表**——如 3.1 所述，refresh 是 stateless JWT 驗證，
不需要查表。

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
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    error_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jobs_user_id ON jobs(user_id);
CREATE INDEX idx_jobs_status ON jobs(status);
```

### 4.3 transcription_db

```sql
CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    language VARCHAR(10),
    full_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
    start_time NUMERIC(10,2) NOT NULL,
    end_time NUMERIC(10,2) NOT NULL,
    speaker_label VARCHAR(50),              -- 講者分離功能預留欄位
    text TEXT NOT NULL,
    sequence_no INT NOT NULL
);

CREATE INDEX idx_segments_transcript_id ON transcript_segments(transcript_id);
```

### 4.4 ai_db

**現況（已建立）**：

```sql
CREATE TABLE summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE,
    summary_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    start_time NUMERIC(10,2) NOT NULL,
    sequence_no INT NOT NULL
);
CREATE INDEX ix_chapters_job_id ON chapters(job_id);
```

`pgvector` extension 有裝在 Postgres 上（docker-compose init script 有啟用），但 ai_db 目前
**沒有任何用到 vector 型別的表**，`ai-service` 程式碼裡也還沒有 embedding 相關邏輯。以下維持原規劃
內容，作為未來要做 RAG 問答/多格式輸出時的 schema 參考，**尚未建立、不代表現在存在**：

**規劃中（尚未建立）**：

```sql
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    chunk_text TEXT NOT NULL,
    start_time NUMERIC(10,2),
    end_time NUMERIC(10,2),
    embedding vector(768),                  -- 依所選 embedding model 維度調整
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_embeddings_job_id ON embeddings(job_id);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE qa_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    user_id UUID NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source_timestamps NUMERIC(10,2)[],
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE export_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL,
    format VARCHAR(50) NOT NULL,            -- meeting_minutes / podcast_desc / youtube_desc / social_post
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(job_id, format)
);
```

---

## 5. 訊息佇列設計（MQ Topics/Queues）

| Queue/Topic | Producer | Consumer | Payload |
|---|---|---|---|
| `transcription.requested` | Upload Service | Transcription Service | `{ jobId, storagePath, fileType }` |
| `transcription.completed` | Transcription Service | AI Service | `{ jobId }` |
| `ai.completed` | AI Service | Notification Service | `{ jobId, status }` |
| `job.failed` | 任一服務 | Notification Service | `{ jobId, stage, errorReason }` |

**實作現況**：實際用的是 **RabbitMQ**（不是原規劃的 Redis Queue），四個 queue 的名稱/payload
都跟上表一致，`job.failed` 目前由 transcription-service、ai-service 各自在 pipeline 失敗時發送。
Redis 本身仍有部署（k8s/docker-compose 都有），但目前沒有任何服務真的連線使用，純粹佔位保留給
未來的 cache/rate limit 用途。

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
| 關聯式資料庫 | PostgreSQL（各服務獨立 schema，Java 用 Hibernate `ddl-auto=update`、Python 用 SQLAlchemy `create_all` 自動建表） |
| 向量資料庫 | pgvector（extension 已裝在 Postgres 上，但目前沒有任何表使用，屬未來規劃，見 8.5） |
| 物件儲存 | MinIO（本機開發）／ Cloudflare R2（正式環境，尚未設定） |
| 訊息佇列 | **RabbitMQ**（實際採用，非原規劃的 Redis Queue；Redis 有部署但目前無服務使用） |
| ASR | Groq Whisper API（`whisper-large-v3-turbo`） |
| LLM（摘要） | Gemini API（`gemini-2.0-flash`，免費層） |
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
| **訊息佇列**（Redis） | **Upstash** | 每月 50 萬次指令、256MB 資料量，按需計費（Serverless） | 超過額度需升級；高頻率輪詢（如 worker 的 BRPOP loop）會快速消耗指令額度，MVP 階段要留意用量 |
| **物件儲存**（音訊/影片檔案） | **Cloudflare R2** | 10GB 儲存空間、每月 100 萬次操作 | 超過額度另計費；免費層無 CDN 加速額外保證，大流量下載需注意頻寬成本 |
| **前端託管** | **Vercel** 或 **Cloudflare Pages** | 個人專案額度足夠，無需信用卡 | 商業用途需確認條款（Vercel 免費層條款僅限個人/非商業用途，正式商用需留意） |
| **ASR（語音轉文字）** | **Groq Whisper API** | 20 RPM、2,000 RPD（每日請求數）、7,200 秒/小時、28,800 秒/天 | 免費層檔案大小上限 25MB，30 分鐘音訊建議壓縮至 MP3 64-128kbps 以免超過限制 |
| **LLM（摘要/問答/embedding）** | **Gemini API（AI Studio）** | 依模型而定，通常為每分鐘/每日請求數限制（RPM/RPD），無需信用卡即可申請 | 免費額度會隨 Google 政策調整而變動，需定期查閱官方文件確認當下額度；正式上線前建議做好額度用盡的降級/重試機制 |

**額度風險提醒**
- 免費層額度通常是「組織/帳號」層級，不是「API Key」層級，開多組 Key 不會疊加額度
- 建議在 `ai-service` 和 `transcription-service` 都做好 429（Too Many Requests）重試與告警機制，避免額度用盡時整條 pipeline 卡死卻沒有任何提示
- Render 免費層的休眠機制會讓使用者第一次連線時等待 30-60 秒，MVP 測試階段可接受，但要事先跟測試者說明，避免誤以為服務掛掉

**建議組合**：Render（3 個後端服務）+ Supabase（Postgres + pgvector）+ Upstash（Redis）+ Cloudflare R2（檔案儲存）+ Vercel（前端），全部組合都不需要信用卡即可開始。

---

## 7. MVP 階段簡化建議

1. **服務註冊/發現**：沒用 Consul/Eureka，靠固定 service name 解析——本機用 docker-compose 內部
   網路，k8s 部署則靠 namespace 內的 Service DNS（見 `infra/k8s/01-configmap.yaml` 的
   `*_GRPC_TARGET` 設定），兩種模式殊途同歸，都不需要額外的服務發現元件
2. **訊息佇列**：實際採用 RabbitMQ（不是原規劃的 Redis Queue，見 5./6. 節），producer/consumer
   沒有額外抽象一層 interface，各服務直接用 pika（Python）/ Spring AMQP（Java）
3. **講者分離**：MVP 先不做，`speaker_label` 欄位保留但先不啟用，之後可接 Groq 或其他支援 diarization 的服務
4. **多格式輸出**：目前**一種格式都還沒做**（只有摘要），原規劃的「先做 1-2 種格式」還沒開始
5. **Auth**：簡單 stateless JWT（HS256，access 15 分鐘/refresh 7 天，無 revocation list），不做完整 OAuth2 flow
6. **可觀測性**：只有基本 log（Python 用標準 `logging`，Java 用 Spring 預設），沒有 tracing（Sleuth/Zipkin 等待流量成長後再導入）
7. **免費 API 額度管理**：AI Service/Transcription Service 呼叫 Gemini/Groq 時需做 429 重試機制與額度監控，避免免費額度用盡導致服務中斷（實作程度未逐行確認，開發時留意）

---

## 8. 待確認事項（開發前建議先想清楚）

- [ ] 30 分鐘音訊限制是否要做「檔案大小」而非「時長」的替代限制（例如 25MB 對齊 Groq 免費層檔案上限）
- [ ] embedding model 選擇（決定 `embeddings.embedding` 欄位的 vector 維度）——embedding 功能本身都還沒開始做，見 8.5
- [x] 章節自動分段的演算法/prompt 設計——**已解決**：純 LLM 判斷（把逐字稿分段連同時間戳丟給
      Gemini，要求回傳 JSON 章節列表），沒有搭配語音停頓偵測，見 `ai-service/app/services/chapter_generator.py`
- [ ] 多格式輸出的模板內容（每種格式要問 Gemini 什麼樣的 prompt）——尚未實作
- [x] 使用者刪除 Job 時是否連帶清除物件儲存檔案——**已解決**：`UploadService.DeleteJob` 會嘗試刪除
      對應的物件儲存檔案，刪除失敗只記警告不擋 Job 刪除（優先保證使用者的刪除意圖，孤兒物件之後
      靠背景清理排除）。embedding 部分因為功能還沒做，暫不適用。
- [x] 授權缺口：使用者只能存取自己的 job——**已解決**：Gateway 在轉發 Transcription/AI 的查詢
      前先呼叫 upload-service 的 `GetJob` 做 ownership 檢查（見 2.1），但 transcription-service /
      ai-service 本身仍不驗證 `x-user-id`，這個決定維持不變（見 2.1 授權模型）

## 8.5 未來規劃（尚未實作）

以下是原本規劃、但目前程式碼裡完全沒有對應實作的功能，列出來避免跟「現況」搞混：

- **Embedding / pgvector**：`ai_db` 沒有 `embeddings` 表，`ai-service` 沒有任何 embedding 產生邏輯
- **RAG 問答**（`POST /qa/{jobId}`）：完全未實作，`ai.proto` 裡也沒有對應的 RPC
- **多格式輸出**（會議紀錄/Podcast 介紹/YouTube 描述/社群貼文）：完全未實作
- **講者分離**：`transcript_segments.speaker_label` 欄位存在但目前一律是 `null`
- **雲端部署**（Render/Supabase/Upstash/R2/Vercel，見 6.5）：規劃內容保留，尚未真的部署上去
- **`x-user-id` 下游驗證**：transcription-service/ai-service 本身仍不驗證這個 header，ownership 檢查目前只在 Gateway 這一層做（見 2.1）——刻意維持的設計決定，不是還沒做
