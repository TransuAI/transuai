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
  → Transcription/AI 這兩個服務的 rpc 本身不驗證 x-user-id（見下方「已知限制」），呼叫時不帶，
    改由 Gateway 自己先用 JobOwnershipGuard 呼叫 upload-service 的 GetJob 確認 job 擁有者
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
| `GET` | `/jobs/{jobId}/media-url?download=` | 取得該 Job 媒體檔案的 presigned 播放 URL（`upload-service` 做 ownership 檢查），見 `../docs/adr/0002-presigned-get-url-for-media-playback.md`；`download=true` 時改拿「以附件方式下載、存成原始檔名」的 URL（轉成 `GetPresignedDownloadUrl` 的 `as_attachment`） |
| `GET` | `/jobs?page=&pageSize=` | 分頁查詢目前使用者的所有 Job |
| `DELETE` | `/jobs/{jobId}` | 刪除 Job，成功回 `204 No Content`（前端 `apiFetchVoid` 依此判斷不去 parse body，別再改回預設的 200） |

### Transcription（`TranscriptionController` → `transcription-service`）—— 需要登入，Gateway 用 `JobOwnershipGuard` 做 ownership 檢查

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/transcripts/{jobId}` | 逐字稿全文 + 片段（id、timestamp、講者標籤 `speakerLabel`、目前文字、原始文字）+ `revision` + 講者列表 `speakers`（`label`、`displayName`、`displayOrder`；沒有講者資訊時是空的、片段的 `speakerLabel` 是 `null`） |
| `GET` | `/transcripts/{jobId}/segments` | 只要片段列表，底層還是同一支 `GetTranscript`，這裡只是回應裁切成 `segments` 陣列（前端目前沒有用這支） |
| `PATCH` | `/transcripts/{jobId}/segments/{segmentId}` | 編輯片段文字，body `{ text }`（空字串＝清空、送回 `originalText`＝還原），回傳 `{ segment, revision }`，轉給 `UpdateSegmentText` |
| `PATCH` | `/transcripts/{jobId}/speakers/{label}` | 替講者命名，body `{ name }`（空字串＝恢復預設名稱「講者 N」），回傳 `{ speaker, revision }`，轉給 `RenameSpeaker` |
| `PUT` | `/transcripts/{jobId}/segments/{segmentId}/speaker` | 改片段的講者，body `{ speakerLabel }`（改成現有講者）或 `{ newSpeaker: { name } }`（新增講者，`name` 可省略＝預設名稱），兩者恰好給一個否則 400；回傳 `{ segment, speakers, revision }`，轉給 `AssignSegmentSpeaker` |

### AI（`AiController` → `ai-service`）—— 需要登入，Gateway 用 `JobOwnershipGuard` 做 ownership 檢查

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/summary/{jobId}` | 取得摘要（含 `sourceRevision`，前端跟逐字稿的 `revision` 比對判斷過時；`regenerationStatus`：`IDLE`／`RUNNING`／`FAILED`；`modelProvider` / `model`：產生它的模型，記錄模型之前的摘要是 `null`） |
| `POST` | `/summary/{jobId}/regenerate` | 在背景依最新逐字稿重新產生摘要與章節，回 `202` 與目前的摘要；轉給 `RequestRegeneration`，帶上當下使用者（用量記在他名下；Job 狀態不變） |
| `GET` | `/chapters/{jobId}` | 取得章節列表（依 `sequence_no` 排序），沒有章節時回空陣列 |
| `GET` | `/qa/{jobId}` | 取得這個 job 的完整問答紀錄（依時間升冪），回傳 `[{ question, answer, sourceTimestamps, createdAt, modelProvider, model }]`（`model` 是回答的模型，記錄模型之前的是 `null`）；一個 job 只有一段連續對話，沒有獨立的 conversation/thread（見 [`../ai-service/CONTEXT.md`](../ai-service/CONTEXT.md)） |
| `GET` | `/ai/models` | 可以選的模型：`{ models: [{ provider, model, supportsTools }], openrouterCustom }`，平台模型加上有自有金鑰的廠商整理好的清單；轉給 `ListAvailableModels` |
| `GET` | `/me/default-model` | 目前的預設模型 `{ provider, model, supportsTools }`（沒選過就是平台模型）；轉給 `GetDefaultModel` |
| `PUT` | `/me/default-model` | 設定預設模型，body `{ provider, model }`（`provider` 是 `platform` 時 `model` 可省略）；清單外的模型回 400、沒有那個廠商的自有金鑰回 409、OpenRouter 查不到回 503；轉給 `SetDefaultModel` |
| `GET` | `/me/provider-keys` | 登入者的自有金鑰：`[{ provider, last4, createdAt }]`，金鑰本身永遠不回傳；轉給 `ListProviderKeys` |
| `PUT` | `/me/provider-keys/{provider}` | 存入或替換自有金鑰，body `{ key }`（`provider` 是 `openai` / `anthropic` / `gemini` / `openrouter`）；ai-service 先向廠商驗證，無效回 400（附原因）、廠商暫時連不上回 503、沒設定主金鑰回 409，都不會存；轉給 `SaveProviderKey` |
| `DELETE` | `/me/provider-keys/{provider}` | 刪除自有金鑰，回 `{ deleted, defaultModelReset }`（預設模型正在用它時改回平台模型）；轉給 `DeleteProviderKey` |
| `GET` | `/jobs/{jobId}/usage` | 這個 Job 的用量：`{ records, totals }`，`records` 依時間排序，每筆有 `kind`（`llm` / `transcription`）、`feature`、`provider`、`model`、`keySource`、`inputTokens`、`outputTokens`、`audioSeconds`（未知是 `null`）、`succeeded`、`createdAt`；`totals` 是已知數字的加總。LLM 用量來自 ai-service 的 `ListJobLlmUsage`，轉錄用量來自 transcription-service 的 `ListJobTranscriptionUsage`（`feature` 是 `transcription`、`keySource` 是 `platform`），在這裡合併 |
| `GET` | `/me/usage?month=YYYY-MM` | 登入者某個月的用量：`{ month, llm: [{ provider, model, keySource, inputTokens, outputTokens, calls, callsWithUnknownUsage }], transcription: [{ provider, model, audioSeconds, calls, callsWithUnknownUsage }] }`。月份依台灣時間（`Asia/Taipei`）切成時間範圍，省略就是這個月，格式不對回 400；數字是已知的加總，`callsWithUnknownUsage` 是沒回報用量的呼叫次數。分別轉給 ai-service 的 `SumUserLlmUsage` 與 transcription-service 的 `SumUserTranscriptionUsage` |
| `POST` | `/qa/{jobId}` | RAG 問答（含最近 5 輪對話記憶），body `{ "question": string, "model"?: { provider, model } }`（`model` 只用在這一次提問，省略就用預設模型；用不到的模型回 400），回傳 `text/event-stream`（SSE，見下方「問答 streaming」一節）；還沒有 embedding（pipeline 沒跑完）在串流開始前就回 404，不會是 SSE error event |

#### 問答 streaming

`POST /qa/{jobId}` 回傳 SSE，四種 event，`data` 一律是後端已經 JSON encode 過的單行字串：

| event | data | 說明 |
|---|---|---|
| `sources` | `number[]` | 檢索到的來源時間戳，恰好一次，在文字開始生成之前送出 |
| `model` | `{ provider, model }` | 這次用哪個模型回答，恰好一次，在 `sources` 之後、第一個 `delta` 之前 |
| `delta` | `string` | 答案文字的其中一段，依生成順序送出任意數量次 |
| `error` | `string` | 這輪問答中途失敗（改寫/檢索/生成任一步出錯；模型呼叫失敗時點出廠商與原因），恰好一次；送出後 stream 結束，這輪不會寫進 `qa_history` |

成功的話 stream 在最後一個 `delta` 後直接結束，沒有額外的「done」event——HTTP 連線關閉本身就是 done。前端不能用瀏覽器原生 `EventSource`（見 [`../docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](../docs/adr/0001-sse-via-gateway-for-streaming-qa.md)）：這裡全部端點都是 Bearer JWT 驗證，`EventSource` 沒辦法附加 Authorization header，前端改用 `fetch()` + `ReadableStream` 手動解析（見 [`../frontend/README.md`](../frontend/README.md)）。

`architecture-design.md` §3.4 還規劃了 `POST /export/{jobId}`、`GET /export/{jobId}/{format}`——ai-service 目前還沒有對應的 rpc（見 [`../ai-service/README.md`](../ai-service/README.md) 已知限制），沒有 rpc 可以轉發，這裡先不開，等 ai-service 補上再加。

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
  grpc/               GrpcMetadataSupport（組 x-user-id metadata）、JobOwnershipGuard（Transcription/AI 端點的 ownership 檢查）、
                       GrpcTimestamps、UploadMapper（proto ↔ DTO）
```

## 已知限制 / 待辦

- **Transcription / AI 這幾個端點的 ownership 檢查多一趟 gRPC 呼叫**：`transcription-service` 的 `GetTranscript`、`ai-service` 的 `GetSummary`/`ListChapters`/`AskQuestion`/`ListQaHistory` 本身還是不驗證 `x-user-id`（只驗 job_id 存不存在，見兩邊 proto 的註解；`AskQuestion` 的 `user_id` 只用來記錄 `qa_history`，不重新驗證），Gateway 現在會在轉發前先呼叫 `upload-service` 的 `GetJob` 確認 ownership（`JobOwnershipGuard`，別人的 job 回 404），每個請求因此多一趟內部 gRPC 往返——量大的話可以考慮快取，MVP 階段先不做
- 多格式輸出（`POST /export/{jobId}` 系列）架構文件有規劃，但 ai-service 還沒實作對應的 rpc，這裡也還沒開
- 沒有限流（架構文件 §2 有提到 Gateway 要做「限流」），MVP 階段先不做
- JWT 沒有做「登出」或「撤銷」機制——refresh token 是純 stateless JWT，撤銷需要 auth-service 那邊先加 `refresh_tokens` 表（見 [`../auth-service/README.md`](../auth-service/README.md) 已知限制）
- `POST /qa/{jobId}` 的 `SseEmitter` 沒設 timeout（`new SseEmitter(0L)`），串流時間完全取決於 LLM 生成速度；如果下游 Groq 呼叫本身卡住不回應，這個連線會一直開著直到客戶端斷線，沒有額外的伺服器端逾時保護（見 [`../docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](../docs/adr/0001-sse-via-gateway-for-streaming-qa.md)）
- 沒有測試，目前只靠手動 smoke test（curl 跑過 register → login → me → presign → list jobs 全流程，以及 400/401/404/503 各種錯誤情境）
