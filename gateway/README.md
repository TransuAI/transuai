# gateway

音訊/影片逐字稿 + AI 分析平台的 API Gateway。是整個平台**唯一**對前端開放 REST API 的服務，其餘服務（[`auth-service`](../auth-service)、[`upload-service`](../upload-service)、[`transcription-service`](../transcription-service)、[`ai-service`](../ai-service)）都是純內部 gRPC 服務，只信任這個 Gateway 直接呼叫（對應 [`architecture-design.md`](../architecture-design.md) 2「API Gateway」一列）。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Spring Boot 4.1（Java 26），`spring-boot-starter-webmvc` |
| 對前端 | REST（JSON），對照 [`architecture-design.md`](../architecture-design.md) §3.1-3.4 |
| 對下游服務 | gRPC blocking stub，`ManagedChannel` 直連四個服務固定位址（見下方「環境變數」），不透過 declarative `spring.grpc.client.channels.*`，單純 `@Bean` 手動組——跟其他服務用 `grpc.insecure_channel(target)` / `ManagedChannelBuilder.forTarget` 是同一種簡單模式，見 `config/GrpcClientConfig.java` |
| JWT 驗證 | [`jjwt`](https://github.com/jwtio/jjwt) 本地驗章（HS256），沒有拉整個 Spring Security——只需要一個 `OncePerRequestFilter` 解 `Authorization: Bearer`，不需要 form login / CSRF / 多重 filter chain |
| API 文件 | [springdoc-openapi](https://springdoc.org/)，`GET /v3/api-docs`、`GET /swagger-ui.html` |

> **架構文件原本寫的是 Spring Cloud Gateway**（declarative 反向代理），但下游服務全部只講 gRPC，Spring Cloud Gateway 的 route 是設計給 HTTP→HTTP 轉發，沒辦法直接轉 gRPC。這裡改成一個一般的 Spring Boot Web app：REST controller 直接呼叫 gRPC blocking stub、手動把回應組成 JSON DTO——本質上是 BFF（Backend For Frontend），跟平台其他服務「文件寫 REST、實際改 gRPC」的調整方向一致（見 upload-service / transcription-service / ai-service README 的類似說明）。

## 身分模型

跟 [`auth-service`](../auth-service) README 的「身分模型」一節是同一張圖，這裡是驗證端：

```
前端登入 → 呼叫 POST /auth/login（轉發給 AuthService.Login）→ 拿到 access token（15 分鐘）+ refresh token（7 天）
前端後續請求帶 Authorization: Bearer <access_token>
  → JwtAuthenticationFilter 用 app.jwt.secret 本地驗章/驗效期/驗 type=access，解出 user_id
  → controller 呼叫下游 gRPC 服務時，需要身分的（Auth/Upload）透過 GrpcMetadataSupport 帶 x-user-id metadata
  → Transcription/AI 這兩個服務的 rpc 本身不驗證 x-user-id（見下方「已知限制」），呼叫時不帶
access token 過期 → 前端呼叫 POST /auth/refresh（帶 refresh_token，這裡不解析，原樣轉發給 AuthService.Refresh）
```

**`app.jwt.secret` 必須跟 auth-service 的完全一致**——本機開發共用同一組預設值即可，正式環境要覆蓋成夠長的隨機值時兩邊要同時改（少於 32 bytes 會被 HS256 直接拒絕，啟動時就炸）。

## 前置需求

需要先啟動基礎設施，以及 auth-service / upload-service / transcription-service / ai-service（至少要有 auth-service 才能測完整流程，其他服務沒開的話對應端點會回 `503 UNAVAILABLE`，不影響其他端點）：

```bash
cd ../infra
cp .env.example .env   # 第一次使用才需要
docker compose up -d
```

## 啟動服務

```bash
./gradlew bootRun
```

會綁一個 port：

- **`8080`**：REST，唯一的對外入口

## REST API 一覽

對照 [`architecture-design.md`](../architecture-design.md) §3，只實作下游服務目前真的有的 rpc：

### Auth（`AuthController` → `auth-service`）

| Method | Path | 說明 |
|---|---|---|
| `POST` | `/auth/register` | 註冊，不需要 token |
| `POST` | `/auth/login` | 登入，不需要 token |
| `POST` | `/auth/refresh` | 用 refresh token 換發新的 access/refresh token，不需要 `Authorization` header（refresh token 本身就是憑證） |
| `GET` | `/auth/me` | 取得目前使用者資訊，需要 `Authorization: Bearer <access_token>` |

### Upload（`UploadController` → `upload-service`）—— 以下全部需要 `Authorization`

| Method | Path | 說明 |
|---|---|---|
| `POST` | `/uploads/presign` | 取得物件儲存的 presigned upload URL |
| `POST` | `/uploads/complete` | 前端上傳完成後呼叫，建立 Job |
| `GET` | `/jobs/{jobId}` | 查詢單一 Job（`upload-service` 會做 ownership 檢查，別人的 job 回 404） |
| `GET` | `/jobs?page=&pageSize=` | 分頁查詢目前使用者的所有 Job |
| `DELETE` | `/jobs/{jobId}` | 刪除 Job，成功回 `204 No Content`（前端 `apiFetchVoid` 依此判斷不去 parse body，別再改回預設的 200） |

### Transcription（`TranscriptionController` → `transcription-service`）—— 需要登入，但沒有 ownership 檢查（見已知限制）

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/transcripts/{jobId}` | 逐字稿全文 + 分段 timestamp |
| `GET` | `/transcripts/{jobId}/segments` | 只要分段列表（用於前端字幕同步捲動），底層還是同一支 `GetTranscript`，這裡只是回應裁切成 `segments` 陣列 |

### AI（`AiController` → `ai-service`）—— 需要登入，但沒有 ownership 檢查（見已知限制）

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/summary/{jobId}` | 取得摘要 |

`architecture-design.md` §3.4 還規劃了 `GET /chapters/{jobId}`、`POST /qa/{jobId}`、`POST /export/{jobId}`、`GET /export/{jobId}/{format}`——ai-service 目前只做了 `GetSummary`（見 [`../ai-service/README.md`](../ai-service/README.md) 已知限制），沒有對應的 rpc 可以轉發，這裡先不開，等 ai-service 補上再加。

### 錯誤格式

下游 gRPC 呼叫失敗時（`GrpcExceptionAdvice`），統一轉成：

```json
{ "error": "NOT_FOUND", "message": "job not found" }
```

對應表：`INVALID_ARGUMENT`→400、`UNAUTHENTICATED`→401、`PERMISSION_DENIED`→403、`NOT_FOUND`→404、`ALREADY_EXISTS`/`FAILED_PRECONDITION`→409、`UNAVAILABLE`（下游服務沒開/連不上）→503，其餘→500。JWT 驗證失敗（缺 header、簽章錯、過期）直接在 filter 層回 401，不會走到這裡。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `JWT_SECRET` | `dev-only-shared-secret-change-me-before-any-real-deployment` | HS256 驗章密鑰，**必須跟 auth-service 的 `JWT_SECRET` 一致** |
| `AUTH_SERVICE_GRPC_TARGET` | `localhost:9091` | auth-service |
| `UPLOAD_SERVICE_GRPC_TARGET` | `localhost:9090` | upload-service |
| `TRANSCRIPTION_SERVICE_GRPC_TARGET` | `localhost:8083` | transcription-service |
| `AI_SERVICE_GRPC_TARGET` | `localhost:8084` | ai-service |

## 專案結構

```
src/main/java/com/transuai/gateway/
  config/            GrpcClientConfig（4 個 ManagedChannel + blocking stub bean）、GrpcProperties、WebConfig
  security/           JwtProperties、JwtService（只驗證 access token）、JwtAuthenticationFilter、InvalidTokenException
  web/                CurrentUserId annotation + CurrentUserIdArgumentResolver、AuthController、UploadController、
                       TranscriptionController、AiController
  web/dto/            REST 用的 JSON DTO（跟 proto message 分開，不直接把 protobuf 型別序列化給前端）
  web/advice/         GrpcExceptionAdvice（StatusRuntimeException → HTTP status + JSON error body）
  grpc/               GrpcMetadataSupport（組 x-user-id metadata）、GrpcTimestamps、UploadMapper（proto ↔ DTO）
```

## 已知限制 / 待辦

- **Transcription / AI 這兩個端點沒有 ownership 檢查**：`transcription-service` 的 `GetTranscript`、`ai-service` 的 `GetSummary` 本身就不驗證 `x-user-id`（只驗 job_id 存不存在，見兩邊 proto 的註解），Gateway 這裡只確保「有登入」，沒有像 Upload 那樣進一步確認「這個 job 是不是你的」。要補的話得先呼叫 `upload-service` 的 `GetJob` 確認 ownership，再決定要不要轉發——目前沒做，是整個平台目前唯一的越權查詢風險（可以用別人的 job_id 查到逐字稿/摘要）
- Chapters（`GET /chapters/{jobId}`）、QA（`POST /qa/{jobId}`）、多格式輸出（`POST /export/{jobId}` 系列）架構文件有規劃，但 ai-service 還沒實作對應的 rpc，這裡也還沒開
- 沒有限流（架構文件 §2 有提到 Gateway 要做「限流」），MVP 階段先不做
- JWT 沒有做「登出」或「撤銷」機制——refresh token 是純 stateless JWT，撤銷需要 auth-service 那邊先加 `refresh_tokens` 表（見 [`../auth-service/README.md`](../auth-service/README.md) 已知限制）
- 沒有測試，目前只靠手動 smoke test（curl 跑過 register → login → me → presign → list jobs 全流程，以及 400/401/404/503 各種錯誤情境）
