# upload-service

音訊/影片逐字稿 + AI 分析平台的 Upload Service。負責檔案上傳（presigned URL）、Job 建立與狀態管理，是純內部服務（透過 API Gateway 對外），服務間溝通走 **gRPC**，不提供業務用 REST API。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Spring Boot 4.1（Java 26） |
| API | gRPC（`org.springframework.boot:spring-boot-starter-grpc-server`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/) |
| 資料庫 | PostgreSQL（`upload_db`），Hibernate `ddl-auto=update` 自動建表（MVP 階段，尚未導入 Flyway） |
| 物件儲存 | S3 相容 API（本機開發打 MinIO，正式環境改指向 Cloudflare R2） |
| 訊息佇列 | RabbitMQ（發送 `transcription.requested` 事件） |
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

Proto 定義（等同於這個服務的 API 規格書）在 [`src/main/proto/upload.proto`](src/main/proto/upload.proto)。

### API 一覽

`UploadService`（`transuai.upload.v1`）：

| RPC | 說明 |
|---|---|
| `GetPresignedUploadUrl` | 取得物件儲存的 presigned PUT URL，此階段尚未建立 Job |
| `CompleteUpload` | 前端完成上傳後呼叫，建立 Job（status=`UPLOADED`）並發送 `transcription.requested` 事件 |
| `GetJob` | 查詢單一 Job，強制 ownership 檢查（別人的 Job 回 `NOT_FOUND`） |
| `ListJobs` | 分頁查詢目前使用者的所有 Job |
| `DeleteJob` | 刪除 Job record 與物件儲存檔案 |

Job 狀態機：`PENDING → UPLOADING → UPLOADED → TRANSCRIBING → TRANSCRIBED → SUMMARIZING → COMPLETED`（任一階段可轉 `FAILED`）。Upload Service 只會把新建的 Job 寫成 `UPLOADED`；`UPLOADED` 之後的每一步轉換都是由下游服務透過 `InternalJobService.UpdateJobStatus` 回寫。

`InternalJobService`（`transuai.upload.v1`）—— 純內部 service，供 pipeline 下游（Transcription Service / AI Service）回呼，不透過 Gateway、也不需要 `x-user-id`（呼叫方只有 `job_id`，整個 service 在 `UserIdServerInterceptor` 中豁免）：

| RPC | 說明 |
|---|---|
| `UpdateJobStatus` | 依 `job_id` 更新 Job 狀態，可選帶 `error_reason`（轉 `FAILED` 時使用） |

## 環境變數

本機開發用預設值即可（對齊 `infra/.env.example`），正式環境部署時覆蓋：

| 變數 | 預設值 | 說明 |
|---|---|---|
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | Postgres |
| `DB_USER` / `DB_PASSWORD` | `admin` / `0000` | Postgres 帳密 |
| `STORAGE_ENDPOINT` | `http://localhost:9000` | 物件儲存 endpoint（本機 MinIO，正式環境改 R2） |
| `STORAGE_PUBLIC_ENDPOINT` | 同 `STORAGE_ENDPOINT` | presigned URL 簽給瀏覽器用，host 必須是瀏覽器連得到的位址；沒特別設就沿用 `STORAGE_ENDPOINT`（docker-compose 模式兩者相同，k8s 模式需另外指定，見 `infra/k8s/01-configmap.yaml`） |
| `STORAGE_REGION` | `us-east-1` | 物件儲存 region（MinIO 用假值即可） |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | `admin` / `00000000` | 物件儲存帳密 |
| `STORAGE_BUCKET` | `media-uploads` | bucket 名稱 |
| `STORAGE_PATH_STYLE_ACCESS` | `true` | MinIO 需要 path-style，正式環境用 R2 也維持 `true` |
| `STORAGE_PRESIGN_EXPIRY_MINUTES` | `15` | presigned URL 有效期限（分鐘） |
| `RABBITMQ_HOST` / `RABBITMQ_PORT` | `localhost` / `5672` | RabbitMQ |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `admin` / `0000` | RabbitMQ 帳密 |

## 測試

```bash
./gradlew test
```

`UploadGrpcServiceIT` 是涵蓋全部 5 支 rpc 的整合測試（`@SpringBootTest` + in-process gRPC transport），會**直接連本機真實的 Postgres / RabbitMQ / MinIO**（沒有 mock），所以跑測試前一樣要先 `docker compose up -d` 把 infra 開著。

## 專案結構

```
src/main/proto/upload.proto          gRPC API 定義（唯一的 API 規格來源）
src/main/java/com/transuai/upload_service/
  domain/          Job entity、FileType / JobStatus enum（狀態機）
  repository/       Spring Data JPA repository
  service/          StorageService（S3 presign / head / delete）
  event/            JobEventPublisher 抽象 + RabbitMQ 實作（發送 transcription.requested）
  grpc/             UploadGrpcService（5 支 rpc 實作）、InternalJobGrpcService（UpdateJobStatus）、JobMapper（domain ↔ proto）
  grpc/auth/        UserIdServerInterceptor（解析 x-user-id metadata）、GrpcAuthContext
  grpc/advice/      GrpcExceptionAdvice（非預期例外 → 安全的 gRPC Status，避免內部細節外洩）
  config/           StorageConfig / RabbitConfig 與對應的 @ConfigurationProperties
```

## 已知限制 / 待辦

- Schema 目前靠 Hibernate `ddl-auto=update` 自動建表，團隊變大或要上正式環境前應改用 Flyway 做版本化 migration
- Upload Service 不驗證 JWT，完全信任呼叫端轉發的 `x-user-id` metadata —— 前提是網路層保證只有 Gateway 能直接打到這個服務的 9090 port
- 刪除 Job 時只清 Upload Service 自己的資料（DB row + 物件儲存），不會連帶清除其他服務的逐字稿/embedding（見 [`architecture-design.md`](../architecture-design.md) 第 8 節待確認事項）
