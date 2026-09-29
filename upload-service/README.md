# upload-service

音訊/影片逐字稿 + AI 分析平台的 Upload Service。負責檔案上傳（presigned URL）、Job 建立與狀態管理，是純內部服務（透過 API Gateway 對外），服務間溝通走 **gRPC**，不提供業務用 REST API。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Spring Boot 4.1（Java 26） |
| API | gRPC（`org.springframework.boot:spring-boot-starter-grpc-server`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/) |
| 資料庫 | PostgreSQL（`upload_db`），Hibernate `ddl-auto=update` 自動建表（MVP 階段，尚未導入 Flyway） |
| 物件儲存 | S3 相容 API（本機開發打 MinIO，正式環境改指向 Cloudflare R2） |
| 訊息佇列 | RabbitMQ（發送 `transcription.requested` 事件），`RabbitTemplate` 開了發送重試（`spring.rabbitmq.template.retry.*`：初始 1s、倍增、封頂 30s、最多 5 次），broker 暫時連不上時自動重試而不是直接丟例外給呼叫端 |
| 身分傳遞 | Gateway 驗證 JWT 後，透過 gRPC metadata `x-user-id` 轉發，Upload Service 不重新驗證 JWT |

## 前置需求

需要先啟動基礎設施（Postgres / RabbitMQ / MinIO）：

```bash
cd ../infra
cp .env.example .env   # 第一次使用才需要
docker compose up -d
```

詳見 [`infra/README.md`](../infra/README.md)。

## 啟動服務

```bash
./gradlew bootRun
```

會綁兩個 port：

- **`9090`**：gRPC，這是實際的 API 入口
- **`8082`**：HTTP（Tomcat）。目前沒有掛任何 REST controller，是專案骨架保留的 `spring-boot-starter-webmvc`，供未來 Actuator health check 等用途使用

## 測試 gRPC API

Upload Service 沒有 Swagger/OpenAPI —— 那是 REST 專屬的規格，gRPC 對應的是 **[server reflection](https://grpc.io/docs/guides/reflection/)**（已開啟），讓 client 在 runtime 動態查詢有哪些 service/method/message，不需要先拿到 `.proto` 檔案。實際測試方式：

- **Postman**：新分頁選 gRPC，連線到 `localhost:9090`，靠 reflection 自動列出所有 method
- **[grpcui](https://github.com/fullstorydev/grpcui)**（網頁版，體驗類似 Swagger UI）：`grpcui -plaintext localhost:9090`
- **[grpcurl](https://github.com/fullstorydev/grpcurl)**（CLI）：

  ```bash
  # 列出所有 service
  grpcurl -plaintext localhost:9090 list

  # 列出 UploadService 的所有 method
  grpcurl -plaintext localhost:9090 list transuai.upload.v1.UploadService

  # 呼叫一個 rpc（所有 rpc 都需要帶 x-user-id metadata，模擬 Gateway 轉發的身分）
  grpcurl -plaintext -H "x-user-id: 11111111-1111-1111-1111-111111111111" \
    -d '{"fileName":"meeting.mp3","fileType":"AUDIO","fileSizeBytes":1024}' \
    localhost:9090 transuai.upload.v1.UploadService/GetPresignedUploadUrl
  ```

Proto 定義（等同於這個服務的 API 規格書）在 [`../infra/proto/upload.proto`](../infra/proto/upload.proto)（集中放在 infra，供 transcription-service / ai-service / Gateway 共用，`build.gradle` 直接從那裡編）。

### API 一覽

`UploadService`（`transuai.upload.v1`）：

| RPC | 說明 |
|---|---|
| `GetPresignedUploadUrl` | 取得物件儲存的 presigned PUT URL，此階段尚未建立 Job；`file_size_bytes` 超過上傳大小限制會回 `INVALID_ARGUMENT`（見下方「上傳大小限制」） |
| `CompleteUpload` | 前端完成上傳後呼叫，建立 Job（status=`UPLOADED`）並發送 `transcription.requested { jobId, userId, storagePath, fileType, transcriptionLanguage }` 事件（`userId` 一路帶到 ai-service，用量記在他名下；`transcription_language` 是 `zh-TW`（中文，沒帶時的預設）、`en` 或 `auto`，其他值回 `INVALID_ARGUMENT`，存在 Job 上，見 transcription-service ADR 0002）；會改問物件儲存實際存了多大（不信任請求帶的 `file_size_bytes`），超過限制回 `INVALID_ARGUMENT` 並刪除該物件 |
| `GetJob` | 查詢單一 Job，強制 ownership 檢查（別人的 Job 回 `NOT_FOUND`） |
| `GetPresignedDownloadUrl` | 取得該 Job 媒體檔案的 presigned **GET** URL，供前端播放器直接讀取；ownership 檢查方式跟 `GetJob` 一樣（別人的 Job 回 `NOT_FOUND`），見 `docs/adr/0002-presigned-get-url-for-media-playback.md`。`as_attachment=true` 時 URL 會覆寫回應的 `Content-Disposition` 為 attachment、檔名＝Job 原始檔名（RFC 6266 ASCII 備援＋RFC 5987 UTF-8），供前端「匯出 → 下載原始檔」 |
| `ListJobs` | 分頁查詢目前使用者的 Job（新的在前，`page` 從 1 開始，0 或沒帶當成 1）：`query` 找**標題**或**檔名**包含它的（去頭尾空白、不分大小寫，`%` `_` `\` 照字面比對），`category` 只看某個類型（不在清單回 `INVALID_ARGUMENT`）；空字串＝不篩，`total_count` 跟著條件算 |
| `DeleteJob` | 刪除 Job record、它的筆記與物件儲存檔案 |
| `UpdateJob` | 使用者改**標題**與**類型**（見 `CONTEXT.md`）：只改有帶的欄位（`optional`），帶了的記為使用者設定過（`*_set_by_user`），`SetSuggestedDetails` 之後不會再寫；標題去頭尾空白、空字串＝清空（顯示檔名，仍算設定過）；標題超過 100 字或類型不在清單回 `INVALID_ARGUMENT`，別人的 Job 回 `NOT_FOUND` |

`NoteService`（`transuai.upload.v1`）—— **筆記**（見 `CONTEXT.md`「筆記」「書籤」），跟 `UploadService` 一樣需要 `x-user-id`：Job 不是這位使用者的、或筆記不屬於這個 Job，一律 `NOT_FOUND`。資料在 `job_notes`：

| RPC | 說明 |
|---|---|
| `ListNotes` | 一個 Job 的筆記，依時間排序（沒有時間的在最後），同一個時間依建立順序 |
| `CreateNote` | 新增：時間（秒，可以沒有）、文字（最多 2,000 字）、來源（`manual` 預設、`qa` 從問答存的）；時間與文字不能都沒有、時間不能是負的或超過錄音長度（知道長度時）、一個 Job 最多 500 則，不符合回 `INVALID_ARGUMENT` |
| `UpdateNote` | 只改文字；清空文字只在筆記有時間時可以（變成書籤） |
| `DeleteNote` | 刪除一則 |

Job 狀態機：`PENDING → UPLOADING → UPLOADED → TRANSCRIBING → TRANSCRIBED → SUMMARIZING → COMPLETED`（任一階段可轉 `FAILED`）。Upload Service 只會把新建的 Job 寫成 `UPLOADED`；`UPLOADED` 之後的每一步轉換都是由下游服務透過 `InternalJobService.UpdateJobStatus` 回寫。

`InternalJobService`（`transuai.upload.v1`）—— 純內部 service，供 pipeline 下游（Transcription Service / AI Service）回呼，不透過 Gateway、也不需要 `x-user-id`（呼叫方只有 `job_id`，整個 service 在 `UserIdServerInterceptor` 中豁免）：

| RPC | 說明 |
|---|---|
| `UpdateJobStatus` | 依 `job_id` 更新 Job 狀態，可選帶 `error_reason`（轉 `FAILED` 時使用） |
| `SetSuggestedDetails` | AI 依內容建議的**標題**與**類型**（見 `CONTEXT.md`；ai-service 的 pipeline 在摘要之後、回寫 COMPLETED 之前呼叫）：使用者改過的欄位（`title_set_by_user` / `category_set_by_user`）不動、空字串的欄位不動、標題截到 100 字；類型不在清單回 `INVALID_ARGUMENT`，`job_id` 格式不對回 `INVALID_ARGUMENT`、找不到回 `NOT_FOUND` |

### 上傳大小限制

兩層限制，各自對應不同的目的（見 [`docs/adr/0001-upload-size-limit-is-file-type-aware.md`](docs/adr/0001-upload-size-limit-is-file-type-aware.md)）：

- **一般濫用防護上限**（`app.upload.max-file-size-bytes`，預設 1GB）：不分檔案類型，套用在所有上傳。
- **AUDIO 專用上限**（`app.upload.max-audio-file-size-bytes`，預設 120MB）：只套用在 `file_type == AUDIO`，放得下 1 小時 256kbps 的錄音（未壓縮的 WAV 放不下，要先轉檔）。原本是 20MB，為了對齊 Groq Whisper 免費層的檔案大小限制；語音辨識換成 Deepgram 後沒有那個上限（見 `transcription-service/docs/adr/0001-deepgram-replaces-groq-for-transcription-and-diarization.md`），2026-09-28 跟著前端的時長上限（`upload-page.tsx`，60 分鐘）一起抓在大約 1 小時。

`GetPresignedUploadUrl` 用呼叫端回報的 `file_size_bytes` 做早期擋檢查；`CompleteUpload` 改問物件儲存實際存了多大，不信任呼叫端回報的數字——這關沒過，物件會被立即刪除。

## 環境變數

本機開發用預設值即可（對齊 `infra/.env.example`），正式環境部署時覆蓋：

| 變數 | 預設值 | 說明 |
|---|---|---|
| `APP_ENV` | `development` | `production` 時檢查密鑰並關掉開發用的東西，見「正式環境」 |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | Postgres |
| `DB_USER` / `DB_PASSWORD` | `admin` / `0000` | Postgres 帳密 |
| `STORAGE_ENDPOINT` | `http://localhost:9000` | 物件儲存 endpoint（本機 MinIO，正式環境改 R2） |
| `STORAGE_PUBLIC_ENDPOINT` | 同 `STORAGE_ENDPOINT` | presigned URL 簽給瀏覽器用，host 必須是瀏覽器連得到的位址；沒特別設就沿用 `STORAGE_ENDPOINT`（docker-compose 模式兩者相同，k8s 模式需另外指定，見 `infra/k8s/01-configmap.yaml`） |
| `STORAGE_REGION` | `us-east-1` | 物件儲存 region（MinIO 用假值即可） |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | `admin` / `00000000` | 物件儲存帳密 |
| `STORAGE_BUCKET` | `media-uploads` | bucket 名稱 |
| `STORAGE_PATH_STYLE_ACCESS` | `true` | MinIO 需要 path-style，正式環境用 R2 也維持 `true` |
| `STORAGE_PRESIGN_EXPIRY_MINUTES` | `15` | 上傳用 presigned **PUT** URL 有效期限（分鐘） |
| `STORAGE_PRESIGN_DOWNLOAD_EXPIRY_MINUTES` | `360` | 播放用 presigned **GET** URL 有效期限（分鐘），跟上傳分開設定，見 `docs/adr/0002-presigned-get-url-for-media-playback.md` |
| `MAX_UPLOAD_FILE_SIZE_BYTES` | `1073741824`（1GB） | 一般濫用防護上限，不分檔案類型，見「上傳大小限制」一節 |
| `MAX_AUDIO_UPLOAD_FILE_SIZE_BYTES` | `125829120`（120MB） | AUDIO 專用上限（大約 1 小時的錄音），見「上傳大小限制」一節 |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | RabbitMQ |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `admin` / `0000` | RabbitMQ 帳密 |

## 測試

```bash
./gradlew test
```

`UploadGrpcServiceIT` 是涵蓋全部 5 支 rpc 的整合測試（筆記另有 `NoteGrpcServiceIT`、AI 回寫另有 `InternalJobGrpcServiceIT`）（`@SpringBootTest` + in-process gRPC transport），會**直接連本機真實的 Postgres / RabbitMQ / MinIO**（沒有 mock），所以跑測試前一樣要先 `docker compose up -d` 把 infra 開著。

## 專案結構

```
src/main/java/com/transuai/upload_service/
  domain/          Job entity、FileType / JobStatus enum（狀態機）、JobCategory（類型清單）、JobNoteEntity（筆記）
  repository/       Spring Data JPA repository
  service/          StorageService（S3 presign / head / delete）
  event/            JobEventPublisher 抽象 + RabbitMQ 實作（發送 transcription.requested）
  grpc/             UploadGrpcService（6 支 rpc 實作）、NoteGrpcService（筆記）、InternalJobGrpcService（UpdateJobStatus、SetSuggestedDetails）、JobMapper（domain ↔ proto）
  grpc/auth/        UserIdServerInterceptor（解析 x-user-id metadata）、GrpcAuthContext
  grpc/advice/      GrpcExceptionAdvice（非預期例外 → 安全的 gRPC Status，避免內部細節外洩）
  config/           StorageConfig / RabbitConfig 與對應的 @ConfigurationProperties
```

## 正式環境（`APP_ENV=production`）

`APP_ENV` 預設是 `development`；設成 `production`（Java 服務用 `spring.profiles.active=${APP_ENV:development}`，就是 `production` profile）時：

- 啟動前檢查密鑰（`config/ProductionSecretsCheck`）：`DB_PASSWORD`、`RABBITMQ_PASSWORD`、`STORAGE_SECRET_KEY` 沒設、還是開發用的預設值（`0000`、`admin`、`dev-only-…` 這類，跟 `infra/k8s/02-secret.yaml` 一致）、
  或少於 12 字元，就不啟動，錯誤訊息列出是哪幾個環境變數。
- gRPC reflection 關掉（`application-production.properties`）。

開發環境都不檢查、照舊開著。見 `.scratch/pre-launch-hardening/issues/07`。

## 已知限制 / 待辦

- Schema 目前靠 Hibernate `ddl-auto=update` 自動建表，團隊變大或要上正式環境前應改用 Flyway 做版本化 migration
- Upload Service 不驗證 JWT，完全信任呼叫端轉發的 `x-user-id` metadata —— 前提是網路層保證只有 Gateway 能直接打到這個服務的 9090 port
- 「下載原始檔」靠 presigned URL 帶 `response-content-disposition` 覆寫回應標頭；MinIO 支援（整合測試有驗證），正式環境規劃的 Cloudflare R2 是否支援這個覆寫參數，上雲前要實測確認——不支援的話，前端點「下載原始檔」會在同一分頁直接打開媒體網址、離開 app，而不是下載
- 刪除 Job 時只清 Upload Service 自己的資料（DB row + 物件儲存），不會連帶清除其他服務的逐字稿/embedding（見 [`architecture-design.md`](../architecture-design.md) 第 8 節待確認事項）

- gRPC 服務裡丟出的 `StatusRuntimeException`（例如 `job_id` 格式不對的 `INVALID_ARGUMENT`、找不到的 `NOT_FOUND`）照它自己的 status 回給呼叫端（`GrpcExceptionAdvice`）；之前會被最後的 catch-all 變成 `INTERNAL`。
