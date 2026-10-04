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
| 限流 | Redis（`spring-boot-starter-data-redis`，Lettuce）上的固定視窗計數器，見下方「限流」 |

> **架構文件原本寫的是 Spring Cloud Gateway**（declarative 反向代理），但下游服務全部只講 gRPC，Spring Cloud Gateway 的 route 是設計給 HTTP→HTTP 轉發，沒辦法直接轉 gRPC。這裡改成一個一般的 Spring Boot Web app：REST controller 直接呼叫 gRPC blocking stub、手動把回應組成 JSON DTO——本質上是 BFF（Backend For Frontend），跟平台其他服務「文件寫 REST、實際改 gRPC」的調整方向一致（見 upload-service / transcription-service / ai-service README 的類似說明）。

## 身分模型

跟 [`auth-service`](../auth-service) README 的「身分模型」一節是同一張圖，這裡是驗證端：

```
前端登入 → 呼叫 POST /auth/login（轉發給 AuthService.Login）→ 回應本文是 access token（15 分鐘，前端只放在記憶體），
  refresh token（7 天）放在 httpOnly cookie（見下方「refresh token 的 cookie」）
前端後續請求帶 Authorization: Bearer <access_token>
  → JwtAuthenticationFilter 用 app.jwt.secret 本地驗章/驗效期/驗 type=access，解出 user_id
  → controller 呼叫下游 gRPC 服務時，需要身分的（Auth/Upload）透過 GrpcMetadataSupport 帶 x-user-id metadata
  → Transcription/AI 這兩個服務的 rpc 本身不驗證 x-user-id（見下方「已知限制」），呼叫時不帶，
    改由 Gateway 自己先用 JobOwnershipGuard 呼叫 upload-service 的 GetJob 確認 job 擁有者
access token 過期、或重新整理頁面 → 前端呼叫 POST /auth/refresh（瀏覽器自動帶 cookie；這裡不解析 refresh token，從 cookie 拿出來
  原樣轉發給 AuthService.Refresh，舊的隨即作廢、cookie 換成新的，見 auth-service README）
```

### refresh token 的 cookie

refresh token 不在任何回應本文裡，只在 cookie（`security/RefreshTokenCookie`）：JavaScript 讀不到，XSS 偷不走；access token 只放在前端記憶體。

```
Set-Cookie: refresh_token=…; Path=/api/auth; Max-Age=604800; Secure; HttpOnly; SameSite=Strict
```

- **`SameSite=Strict`**：別的網站發起的請求不帶這個 cookie，換發、登出不會被跨站偽造。也因此**前端跟 API 一定要在同一個網站**
 （同一個網域，或同一個網域底下的子網域）——前端 `fetch('/api/…')` 同源呼叫、由反向代理（本機是 Vite 的 proxy）把 `/api` 拿掉轉到
  這個 Gateway 最單純。前端放在 `*.vercel.app`、API 放在 `*.onrender.com` 這種兩個不同網站的部署，cookie 不會送出、登入撐不過重新整理。
- **`Path`**（`REFRESH_COOKIE_PATH`，預設 `/api/auth`）：是**瀏覽器看到的**路徑，只有換發、登出（還有同一路徑底下的登入、註冊）會帶它，
  其他 API 不帶。API 不是掛在 `/api` 底下時要改。
- **`Secure`**（`REFRESH_COOKIE_SECURE`，預設 `true`）：只在 HTTPS 送。Chrome、Firefox 把 `http://localhost` 當成安全的，本機開發照樣能用；
  Safari 不行，本機用 Safari 要設 `false`。正式環境（`APP_ENV=production`）固定是 `true`，不看這個變數。
- **`Max-Age`**：跟 auth-service 的 refresh token 一樣長，讀同一個 `JWT_REFRESH_TOKEN_TTL_DAYS`（預設 7 天）。
- 換發時 auth-service 不認這個 token（過期、作廢、被盜）就清掉 cookie、回 401；登出、登出所有裝置也會清掉 cookie。

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
| `POST` | `/auth/register` | 註冊，不需要 token；回 `{ accessToken, user }`，refresh token 設在 cookie |
| `POST` | `/auth/login` | 登入，不需要 token；回 `{ accessToken, user }`，refresh token 設在 cookie |
| `POST` | `/auth/logout` | 登出：作廢 cookie 裡這個 refresh token 所在的那一串、清掉 cookie，回 `204`；不需要 `Authorization`（access token 可能已經過期），沒有 cookie 或 token 無效也回 `204` |
| `POST` | `/auth/logout-all` | 登出所有裝置：作廢登入者所有的 refresh token、清掉這個瀏覽器的 cookie，回 `204`，需要 `Authorization`；已簽出的 access token 仍有效到過期（最多 15 分鐘） |
| `POST` | `/auth/account/delete` | 刪除帳號：body `{ password }`（再輸入一次密碼），需要 `Authorization`。成功 `204` 並清掉 cookie；密碼錯 `403`（不是 401，前端不會去換發 token）；沒帶密碼 `400`；猜錯太多次 `429`（見「限流」）。auth-service 刪掉使用者並發 `account.deleted`，其他服務清掉他的資料（見 auth-service README「刪除帳號」）。刪除之後，還沒過期的 access token 也不能用（見下方） |
| `POST` | `/auth/refresh` | 用 cookie 裡的 refresh token 換發：回 `{ accessToken, user }`，cookie 換成新的 refresh token；不需要 `Authorization`、沒有 body。沒有 cookie 或 token 不能用回 `401`（並清掉 cookie） |
| `GET` | `/auth/me` | 取得目前使用者資訊，需要 `Authorization: Bearer <access_token>` |

### Upload（`UploadController` → `upload-service`）—— 以下全部需要 `Authorization`

| Method | Path | 說明 |
|---|---|---|
| `POST` | `/uploads/presign` | 取得物件儲存的 presigned upload URL；body 帶 `durationSeconds`（檔案長度，檢查每月用量上限用，可省略） |
| `POST` | `/uploads/complete` | 前端上傳完成後呼叫，建立 Job；body 的 `transcriptionLanguage` 是轉錄語言 `zh-TW`（中文，省略時的預設）/ `en` / `auto`（自動偵測中英文），回傳的 Job 也帶這個欄位（之前建立的 Job 是 `zh-TW`） |
| `GET` | `/jobs/{jobId}` | 查詢單一 Job（`upload-service` 會做 ownership 檢查，別人的 job 回 404）；Job 帶 `title`（標題，沒有是 `null`，前端改顯示檔名）與 `category`（類型：`meeting` / `lecture` / `interview` / `podcast` / `video` / `other`，還沒判斷是 `null`），列表也一樣 |
| `GET` | `/jobs/{jobId}/media-url?download=` | 取得該 Job 媒體檔案的 presigned 播放 URL（`upload-service` 做 ownership 檢查），見 `../docs/adr/0002-presigned-get-url-for-media-playback.md`；`download=true` 時改拿「以附件方式下載、存成原始檔名」的 URL（轉成 `GetPresignedDownloadUrl` 的 `as_attachment`） |
| `GET` | `/jobs?page=&pageSize=&query=&category=` | 分頁查詢目前使用者的 Job（新的在前，`page` 從 1 開始）：`query` 找標題或檔名包含它的（不分大小寫），`category` 只看某個類型（不在清單回 400）；`totalCount` 跟著條件算 |
| `PATCH` | `/jobs/{jobId}` | 改標題與類型 `{ title?, category? }`：只轉發有帶的欄位（沒帶＝不動，標題 `""`＝清空），回更新後的 Job；改過的欄位 AI 之後不會再寫；標題超過 100 字、類型不在清單回 400，別人的 job 回 404（ownership 由 `upload-service` 檢查） |
| `DELETE` | `/jobs/{jobId}` | 刪除 Job（連同它的筆記），成功回 `204 No Content`（前端 `apiFetchVoid` 依此判斷不去 parse body，別再改回預設的 200） |
| `GET` | `/jobs/{jobId}/notes` | 筆記（`NoteController` → upload-service 的 `NoteService`，ownership 由 upload-service 依 `x-user-id` 檢查，別人的 Job 回 404）：`[{ noteId, jobId, timeSeconds, text, source, createdAt, updatedAt }]`，依時間排序、沒有時間（`timeSeconds: null`）的在最後；`source` 是 `manual` 或 `qa` |
| `POST` | `/jobs/{jobId}/notes` | 新增筆記，body `{ timeSeconds?, text?, source? }`；時間與文字都沒有、文字超過 2,000 字、時間超出錄音、超過 500 則回 400 |
| `PATCH` | `/jobs/{jobId}/notes/{noteId}` | 改筆記的文字，body `{ text }`（沒有時間的筆記不能清空，回 400） |
| `DELETE` | `/jobs/{jobId}/notes/{noteId}` | 刪除一則筆記，回 `204` |

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
| `POST` | `/jobs/{jobId}/translations` | 翻譯逐字稿：body `{ "language": "zh-TW" \| "en" \| "ja" \| "ko" }`，回 `202` 與這種語言的譯文（`status: GENERATING`）；一種語言一份，已經在翻就直接回傳，翻好的再要求是補翻缺的；不支援的語言或沒帶回 400；轉給 `RequestTranslation`。花錢的功能、受每月平台模型上限管 |
| `GET` | `/jobs/{jobId}/translations` | 各語言的譯文：`[{ language, status, failureReason, totalSegments, translatedSegments, modelProvider, model, requestedAt, completedAt, segments: null }]`；前端每 3 秒輪詢直到沒有 `GENERATING` |
| `GET` | `/jobs/{jobId}/translations/{language}` | 一種語言含片段：`segments: [{ segmentId, text }]`（翻譯中也有已經翻好的）；沒有這種語言回 404 |
| `DELETE` | `/jobs/{jobId}/translations/{language}` | 刪掉一種語言的譯文（翻譯中也可以），回 `204`；沒有這種語言回 404；轉給 `DeleteTranslation` |
| `POST` | `/jobs/{jobId}/outputs` | 多格式輸出：產生一份，body `{ "format": "podcast_description" \| "youtube_description" \| "blog_post" \| "newsletter" \| "social_post", "platform"?: "threads" \| "facebook" \| "instagram" \| "linkedin" \| "x", "instruction"?: string }`（社群貼文一定要有 `platform`），回 `202` 與「產生中」的那一份；每次都是新的一份。先過 ownership 並取 Job 的標題一起帶給 `RequestOutput`；沒帶 `format` 回 400，格式不認得或要求超過 200 字也是 400。花錢的功能、受每月平台模型上限管 |
| `GET` | `/jobs/{jobId}/outputs` | 這個 Job 的輸出（新的在前）：`[{ id, jobId, format, platform, instruction, status, failureReason, content, sourceRevision, modelProvider, model, requestedAt, completedAt, editedAt }]`；`content` 是 Markdown（完成前 `null`）；前端每 3 秒輪詢直到沒有 `GENERATING` |
| `GET` | `/jobs/{jobId}/outputs/{outputId}` | 一份輸出；不屬於這個 Job 回 404 |
| `PATCH` | `/jobs/{jobId}/outputs/{outputId}` | 修改內容，body `{ "content": string }`；回修改後的那一份（改了的話 `editedAt` 有值）；沒帶或空白、超過 20000 字回 400，還沒產生完成回 409；轉給 `UpdateOutput` |
| `POST` | `/jobs/{jobId}/speaker-insights` | 分析講者的問題與打斷（AI 估計），回 `202` 與目前這一份（`status: GENERATING`）；一個 Job 一份，再分析完成才取代；轉給 `RequestSpeakerInsights`，帶上當下使用者。花錢的功能、受每月平台模型上限管 |
| `GET` | `/jobs/{jobId}/speaker-insights` | `{ status, failureReason, sourceRevision, modelProvider, model, requestedAt, completedAt, items: [{ kind, speakerLabel, interruptedLabel, startTime, text }] }`；`status` 是 `NONE`（還沒分析過）/ `GENERATING` / `COMPLETED` / `FAILED`；`kind` 是 `question` / `interruption`；前端每 3 秒輪詢直到不是 `GENERATING` |
| `POST` | `/jobs/{jobId}/quizzes` | 產生一份測驗，body `{ "questionCount": 5 \| 10 \| 20 }`，回 `202` 與「產生中」的測驗（不含題目）；每次都多一份新的。題數不對回 400；轉給 `RequestQuiz`，帶上當下使用者（用他的預設模型、用量記在他名下） |
| `GET` | `/jobs/{jobId}/quizzes` | 這個 Job 的測驗（新的在前）：`[{ id, jobId, questionCount, status, failureReason, sourceRevision, modelProvider, model, requestedAt, completedAt, questions: null, bestCorrectCount }]`（`bestCorrectCount` 是所有作答裡答對最多的題數，還沒作答過是 `null`）；`status` 是 `GENERATING` / `COMPLETED` / `FAILED`（產生中超過 5 分鐘回報成失敗），前端每 3 秒輪詢直到不是 `GENERATING`；轉給 `ListQuizzes` |
| `GET` | `/jobs/{jobId}/quizzes/{quizId}` | 一份測驗含題目：`questions: [{ kind, prompt, options, correctOption, explanation, sourceTimestamps }]`（`kind` 是 `multiple_choice` / `true_false`；答案直接回傳，作答時不顯示是前端的事）；不屬於這個 Job 回 404；轉給 `GetQuiz` |
| `POST` | `/jobs/{jobId}/quizzes/{quizId}/attempts` | 送出一次作答，body `{ "answers": number[] }`（依題目順序，每題選的選項位置，從 0 開始），ai-service 計分並保存（同一份測驗可以重做，每次都保存），回傳 `{ correctCount, questionCount, results: [{ chosenOption, correctOption, correct, explanation }] }`；題數不對或選項超出範圍回 400，還沒產生完成回 409；轉給 `SubmitQuizAttempt` |
| `GET` | `/jobs/{jobId}/post-meeting` | 會後處理（見 [`../ai-service/CONTEXT.md`](../ai-service/CONTEXT.md)）：`{ available, unavailableReason, latestRun, hints, earlierRuns }`（`hints` 是能跑但有些事做不到的提示，例如還沒指定 Notion 的位置；`earlierRuns` 是這個 Job 之前的紀錄，新的在前，形狀跟 `latestRun` 一樣）；`latestRun` 是 `{ id, status, progress, failureReason, modelProvider, model, requestedAt, finishedAt, proposals: [{ id, service, tool, kind, arguments, status, resultUrl, failureReason, previouslyCreated }] }` 或 `null`（`previouslyCreated`：還沒執行，而且跟這個 Job 其他次已經建立過的事項相同），`status` 是 `RUNNING` / `COMPLETED` / `LIMIT_REACHED` / `FAILED`（執行中超過 5 分鐘回報成失敗）；前端每 3 秒輪詢直到不是 `RUNNING`。轉給 `GetPostMeeting` |
| `POST` | `/jobs/{jobId}/post-meeting` | 開始會後處理，body `{ "timezone": "Asia/Taipei" }`（瀏覽器的 IANA 時區），回 `202` 與上面的內容；Job 建立（上傳）的時間從 upload-service 的 `GetJob` 一起帶過去（換算相對日期）。已經有一份在跑就回那一份；不能跑（預設模型是平台模型而 ai-service 沒有設定會後處理的平台模型、自有金鑰的模型不支援工具呼叫、Google 與 Notion 都沒有連結或已失效）回 409 並附原因，時區不對回 400。轉給 `RequestPostMeeting` |
| `POST` | `/jobs/{jobId}/post-meeting/{runId}/execute` | 執行勾選的行動提案，body `{ "proposals": [{ "proposalId": "...", "arguments": { ... } }] }`（`arguments` 是使用者確認、可能改過的最終參數），回傳整份紀錄（`latestRun` 的形狀），每個提案帶 `status`（`PROPOSED` / `DONE` / `FAILED`）、`resultUrl`、`failureReason`；沒列出的不執行，已建立的不再執行。還在跑回 409，提案不屬於這份紀錄回 400，紀錄不屬於這個 Job 回 404。轉給 `ExecuteProposals` |
| `POST` | `/jobs/{jobId}/post-meeting/{runId}/proposals/{proposalId}/retry` | 用同樣的最終參數重試一個失敗的提案，回傳整份紀錄；不是失敗的回 409。轉給 `RetryProposal` |
| `GET` | `/qa/{jobId}` | 取得這個 job 的完整問答紀錄（依時間升冪），回傳 `[{ question, answer, sourceTimestamps, createdAt, modelProvider, model, webSearch, webSources }]`（`model` 是回答的模型，記錄模型之前的是 `null`；`webSearch` 是這一題有沒有查網路，`webSources` 是 `[{ title, url }]`，順序就是回答裡 [n] 的編號，搜尋失敗時是空的）；一個 job 只有一段連續對話，沒有獨立的 conversation/thread（見 [`../ai-service/CONTEXT.md`](../ai-service/CONTEXT.md)） |
| `GET` | `/jobs/{jobId}/speaker-suggestions` | 講者名字建議：`[{ speakerLabel, name, evidenceStartTime, evidenceText, status }]`（status：`pending` / `applied` / `dismissed`），先過 ownership；轉給 ai-service 的 `ListSpeakerSuggestions` |
| `PUT` | `/jobs/{jobId}/speaker-suggestions/{label}` | 把建議標成已套用或忽略，body `{ "status": "applied" \| "dismissed" }`（套用時前端先呼叫改名，再呼叫這支）；其他 status 回 400、這位講者沒有建議回 404 |
| `GET` | `/ai/models` | 可以選的模型：`{ models: [{ provider, model, supportsTools }], openrouterCustom, webSearch }`（`webSearch`：這個部署的問答能不能查網路），平台模型加上有自有金鑰的廠商整理好的清單；轉給 `ListAvailableModels` |
| `GET` | `/me/default-model` | 目前的預設模型 `{ provider, model, supportsTools }`（沒選過就是平台模型）；轉給 `GetDefaultModel` |
| `PUT` | `/me/default-model` | 設定預設模型，body `{ provider, model }`（`provider` 是 `platform` 時 `model` 可省略）；清單外的模型回 400、沒有那個廠商的自有金鑰回 409、OpenRouter 查不到回 503；轉給 `SetDefaultModel` |
| `GET` | `/me/provider-keys` | 登入者的自有金鑰：`[{ provider, last4, createdAt }]`，金鑰本身永遠不回傳；轉給 `ListProviderKeys` |
| `PUT` | `/me/provider-keys/{provider}` | 存入或替換自有金鑰，body `{ key }`（`provider` 是 `openai` / `anthropic` / `gemini` / `openrouter`）；ai-service 先向廠商驗證，無效回 400（附原因）、廠商暫時連不上回 503、沒設定主金鑰回 409，都不會存；轉給 `SaveProviderKey` |
| `DELETE` | `/me/provider-keys/{provider}` | 刪除自有金鑰，回 `{ deleted, defaultModelReset }`（預設模型正在用它時改回平台模型）；轉給 `DeleteProviderKey` |
| `GET` | `/jobs/{jobId}/usage` | 這個 Job 的用量：`{ records, totals }`，`records` 依時間排序，每筆有 `kind`（`llm` / `transcription` / `web_search`）、`feature`、`provider`、`model`、`keySource`、`inputTokens`、`outputTokens`、`audioSeconds`（未知是 `null`）、`succeeded`、`createdAt`；`totals` 是已知數字的加總。LLM 用量來自 ai-service 的 `ListJobLlmUsage`，轉錄用量來自 transcription-service 的 `ListJobTranscriptionUsage`（`feature` 是 `transcription`、`keySource` 是 `platform`），網路搜尋來自 ai-service 的 `ListJobWebSearches`（`feature` 是 `web_search`、`model` 是空字串、沒有數字、`keySource` 是 `platform`），在這裡合併；`totals.webSearches` 是成功的搜尋次數 |
| `GET` | `/me/post-meeting-settings` | 會後處理的設定：`{ notionMeetingsPage, todoDestination }`，`notionMeetingsPage` 是 `{ id, title, url }` 或 `null`（每場會議在這個頁面底下新增一個子頁面，含待辦清單），`todoDestination` 是 `GOOGLE_TASKS` / `NOTION`（待辦放在 Notion 會議紀錄裡）；轉給 `GetPostMeetingSettings` |
| `PUT` | `/me/post-meeting-settings` | 儲存設定，body `{ notionMeetingsPageUrl, todoDestination }`（網址是 `null` 或空字串是不指定；`todoDestination` 是 `null` 就不變，不是 `GOOGLE_TASKS` / `NOTION` 回 400）；網址改過時 ai-service 先向 Notion 確認（沒改的沿用），沒連結 Notion 回 409、找不到或不是一般頁面回 400（附原因）、連不上 Notion 回 503；轉給 `UpdatePostMeetingSettings` |
| `GET` | `/me/connections` | 已連結的帳號（見 [`../ai-service/CONTEXT.md`](../ai-service/CONTEXT.md)）：`[{ service, status, connectedAt }]`，`service` 是 `google` / `notion`，`status` 是 `CONNECTED` / `INVALID`（已失效，要重新連結）/ `NOT_CONNECTED`；權杖永遠不回傳。轉給 `ListConnections` |
| `GET` | `/me/connections/{service}/authorize` | 回傳 `{ authorizeUrl }`，前端把使用者轉過去（不是 302：前端的 JWT 在 header 裡，瀏覽器轉址帶不過來），同時設一個 10 分鐘的 HttpOnly、SameSite=Lax cookie（`transuai_oauth_binding`，隨機值；ai-service 只存雜湊），把這次授權綁定在這個瀏覽器；回呼網址用 `OAUTH_CALLBACK_BASE_URL`。不支援的服務回 400，伺服器沒設定 Google OAuth client 回 409，連不上 Notion 回 503；轉給 `StartConnection` |
| `GET` | `/oauth/{service}/callback` | Google / Notion 的回呼，**不需要 JWT**（使用者由 `state` 認出來，而且要帶回開始連結時的 cookie——別人的授權網址在使用者瀏覽器裡按同意也連不到使用者的帳號上；用完就清掉 cookie）；轉給 `CompleteConnection`，成功轉址到 `{FRONTEND_URL}/settings?connected={service}`、失敗到 `?connection_failed={service}`（原因只記 log） |
| `DELETE` | `/me/connections/{service}` | 中斷連結：向對方撤銷授權並刪除權杖，回 `{ revoked }`（撤銷失敗時權杖照樣刪除，`revoked` 是 false）；轉給 `DeleteConnection` |
| `GET` | `/me/usage?month=YYYY-MM` | 登入者某個月的用量：`{ month, llm: [{ provider, model, keySource, inputTokens, outputTokens, calls, callsWithUnknownUsage }], transcription: [{ provider, model, audioSeconds, calls, callsWithUnknownUsage }], webSearches: { succeeded, failed }, limits: { transcriptionMinutes, platformTokens, webSearches } }`（`limits` 是每月的用量上限，見「每月用量上限」）。月份依台灣時間（`Asia/Taipei`）切成時間範圍，省略就是這個月，格式不對回 400；數字是已知的加總，`callsWithUnknownUsage` 是沒回報用量的呼叫次數。分別轉給 ai-service 的 `SumUserLlmUsage`、`CountUserWebSearches` 與 transcription-service 的 `SumUserTranscriptionUsage` |
| `POST` | `/qa/{jobId}` | RAG 問答（含最近 5 輪對話記憶），body `{ "question": string, "model"?: { provider, model }, "webSearch"?: boolean }`（`model` 只用在這一次提問，省略就用預設模型；用不到的模型回 400。`webSearch` 為 true 時這一題也查網路，省略就是不查；部署沒設定搜尋服務時忽略），回傳 `text/event-stream`（SSE，見下方「問答 streaming」一節）；還沒有 embedding（pipeline 沒跑完）在串流開始前就回 404，不會是 SSE error event |

#### 問答 streaming

`POST /qa/{jobId}` 回傳 SSE，六種 event，`data` 一律是後端已經 JSON encode 過的單行字串：

| event | data | 說明 |
|---|---|---|
| `step` | `{ id, label, state, detail }` | 回答過程正在做的一步（`id`：`understand` 理解問題、`retrieve` 在內容裡找段落、`search` 查網路、`answer` 撰寫回答；`state`：`running` / `done` / `failed`；`label`、`detail` 是給人看的文字），穿插在其他 event 之間，可能是第一個 event；同一個 `id` 會送好幾次，前端依 `id` 更新 |
| `sources` | `number[]` | 檢索到的來源時間戳，恰好一次，在文字開始生成之前送出 |
| `web_sources` | `{ sources: [{ title, url }], failed: boolean }` | 只有這一題查了網路時送出，恰好一次，在 `sources` 之後、`model` 之前：回答依據的網路來源，順序就是回答裡 [n] 的編號；搜尋失敗時 `sources` 是空的、`failed` 為 true（回答照樣只根據內容產生） |
| `model` | `{ provider, model }` | 這次用哪個模型回答，恰好一次，在 `sources`（與 `web_sources`）之後、第一個 `delta` 之前 |
| `delta` | `string` | 答案文字的其中一段，依生成順序送出任意數量次 |
| `error` | `string` | 這輪問答中途失敗（改寫/檢索/生成任一步出錯；模型呼叫失敗時點出廠商與原因），恰好一次；送出後 stream 結束，這輪不會寫進 `qa_history` |

成功的話 stream 在最後一個 `delta` 後直接結束，沒有額外的「done」event——HTTP 連線關閉本身就是 done。前端不能用瀏覽器原生 `EventSource`（見 [`../docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](../docs/adr/0001-sse-via-gateway-for-streaming-qa.md)）：這裡全部端點都是 Bearer JWT 驗證，`EventSource` 沒辦法附加 Authorization header，前端改用 `fetch()` + `ReadableStream` 手動解析（見 [`../frontend/README.md`](../frontend/README.md)）。

多格式輸出（LLM 依摘要與章節寫成新文件）在上面的 `/jobs/{jobId}/outputs`——刻意不用 `/export`：「匯出」是前端把既有內容轉成檔案（見 `frontend/CONTEXT.md`），沒有後端 API。

### 限流

計數器存在 Redis（gateway 有多個副本時共用），固定視窗：每個鍵第一次計數時開始一段時間，時間到就重算（`ratelimit/RateLimiter`，
計數與設定過期時間在同一個 Lua script 裡；鍵不知為何沒有過期時間時也補上，不會永遠擋著）。超過回 `429`，`Retry-After` 是還要等幾秒，body 是
`{ "error": "RATE_LIMITED", "message": "嘗試太多次，請 N 分鐘後再試" }`（登入、註冊；其他 API 是「使用得太頻繁，請 N 分鐘後再試」，
前端照樣顯示 `message`）。花錢的功能被擋下時（包括 Job 不存在或不是自己的）也算一次，擋下的請求不會送到下游服務。串流結束時的 async
分派與錯誤頁的分派不重算。**Redis 連不上時放行並記 log**（fail-open）：Redis 故障不能把所有人
擋在外面。

| 限制 | 預設 | 說明 |
|---|---|---|
| 登入失敗 | 同一個 IP 對同一個 email，15 分鐘 5 次 | 猜密碼。每次嘗試**先**計成一次失敗再送去 auth-service（同時送出的請求也只放得進 5 次），登入成功就清掉，auth-service 沒回答（例如 503）就退回；到了上限連正確的密碼也擋到時間過去。email 跟 auth-service 一樣去空白、轉小寫（`Locale.ROOT`），Redis 的鍵只放雜湊（看不到 email） |
| 登入 | 同一個 IP，15 分鐘 20 次 | 不分 email，換 email 猜也擋得到 |
| 刪除帳號時的密碼 | 每位使用者，15 分鐘 5 次失敗 | 跟登入失敗同一組設定（`RATE_LIMIT_LOGIN_FAILURES`）。密碼錯（auth-service 的 `PERMISSION_DENIED`）才算，成功就清掉 |
| 註冊 | 同一個 IP，每小時 5 次 | |
| **所有 API**（登入後） | 每位使用者，每分鐘 600 個請求 | `ratelimit/ApiRateLimits`（HandlerInterceptor，在 JWT 驗證之後、controller 之前）；一個 Job 頁面的輪詢最多約每分鐘 75 個請求，同時開幾個分頁也碰不到 |
| **所有 API**（沒登入的：登入、註冊、換發、OAuth 回呼、API 文件，以及 token 缺少或無效被擋下的） | 每個 IP，每分鐘 60 個請求 | 跟上面登入／註冊的限制**同時**生效；token 無效的請求在 `JwtAuthenticationFilter` 裡計數，超過時回 429 而不是 401（拿假 token 亂打的腳本也擋得到） |
| 取得上傳網址（`POST /uploads/presign`） | 每人每小時 30 次 | 以下是**花錢的功能**（controller 方法上標了 `@CostlyFeature("名稱")`），在「所有 API」之外另外算、比較嚴；同一個名稱的 API 共用一個計數。上傳網址：擋住塞滿物件儲存 |
| 完成上傳（`POST /uploads/complete`） | 每人每小時 10 次 | 每次上傳都觸發要付費的轉錄 |
| 問答（`POST /qa/{jobId}`） | 每人每分鐘 20 題 | 每題都呼叫 AI |
| 產生測驗（`POST /jobs/{jobId}/quizzes`） | 每人每小時 10 份 | |
| 分析講者的問題與打斷（`POST /jobs/{jobId}/speaker-insights`） | 每人每小時 10 次 | `RATE_LIMIT_SPEAKER_INSIGHTS` |
| 產生多格式輸出（`POST /jobs/{jobId}/outputs`） | 每人每小時 20 份 | `RATE_LIMIT_OUTPUT` |
| 翻譯逐字稿（`POST /jobs/{jobId}/translations`） | 每人每小時 10 次 | `RATE_LIMIT_TRANSLATION` |
| 重新產生摘要（`POST /summary/{jobId}/regenerate`） | 每人每小時 5 次 | |
| 開始會後處理（`POST /jobs/{jobId}/post-meeting`） | 每人每小時 10 次 | 一次最多 10 次 AI 呼叫 |
| 存自有金鑰（`PUT /me/provider-keys/{provider}`） | 每人每小時 10 次 | 每次都向 AI 廠商驗證：不讓人拿平台去試偷來的金鑰 |
| 編輯逐字稿（改文字、講者名稱、片段講者） | 每人每小時 300 次（共用） | 每次編輯都讓 ai-service 重算 embedding（付費的 API） |
| 會用到外部服務的設定與執行（改預設模型、會後處理設定、開始連結帳號、執行與重試行動提案） | 每人每小時 60 次（共用） | 查 OpenRouter、Notion，呼叫 Google／Notion：用掉平台在對方的額度 |

每個 `@CostlyFeature` 的名稱都要在 `app.rate-limit.costly.<名稱>.*` 設定上限，漏設時 gateway 啟動就失敗（`ApiRateLimits.CostlyFeaturesConfigured`）。

來源 IP 是 `request.getRemoteAddr()`，預設（`FORWARD_HEADERS_STRATEGY=none`）就是直接連進來的位址，**不看 `X-Forwarded-For`**——那是
使用者可以自己填的，信了就能每次換一個假 IP 無限猜密碼（`ForwardedAddressTest` 用真的 Tomcat 驗證）。正式環境在反向代理後面時設
`FORWARD_HEADERS_STRATEGY=native`，並把 `TRUSTED_PROXIES` 設成**那個代理**位址的正規表示式：Tomcat 從 `X-Forwarded-For` 的右邊往左讀、
跳過信任的代理，第一個不是代理的就是來源（代理照常附加這個標頭即可）；沒設 `TRUSTED_PROXIES` 就一個代理都不信。gateway 不能繞過代理
直接對外。本機經過 Vite proxy、`kubectl port-forward` 或 NodePort 時，所有請求都是同一個 IP（每個 IP 的上限等於大家共用）。

登入與註冊沒給 email 或密碼回 400（在限流與 gRPC 之前擋下）。

### 每月用量上限

平台付錢的部分，每位使用者每月（台灣時間）有**用量上限**（見 [`../ai-service/CONTEXT.md`](../ai-service/CONTEXT.md)「用量上限」，`usage/`）：

| 上限 | 預設 | 到了之後 |
|---|---|---|
| 轉錄分鐘數 | 600 分鐘（`USAGE_LIMIT_TRANSCRIPTION_MINUTES`） | `POST /uploads/presign`、`POST /uploads/complete` 回 429；兩者都帶檔案長度 `durationSeconds`（前端量的），整個檔案要放得進剩下的分鐘數——在取得上傳網址時就擋，不讓人傳完 1GB 才被拒 |
| 平台模型的 token（輸入加輸出） | 2,000,000（`USAGE_LIMIT_PLATFORM_TOKENS`） | 要用平台模型的問答、產生測驗、重新產生摘要、開始會後處理回 429；自有金鑰的模型照常可以用（問答這次指定的模型優先，否則看預設模型） |
| 網路搜尋次數（只算成功的） | 30 次（`USAGE_LIMIT_WEB_SEARCHES`） | 帶 `webSearch: true` 的問答回 429；不查網路的問答照常。搜尋服務一律平台付費，用自有金鑰的模型提問也算（Tavily 的免費額度是整個平台每月 1,000 次） |

用量是 `/me/usage` 同一份加總（`usage/MonthlyUsage`：LLM 向 ai-service 的 `SumUserLlmUsage`、網路搜尋向 `CountUserWebSearches`、轉錄向
transcription-service 的 `SumUserTranscriptionUsage`，自有金鑰的 LLM 用量不算），在送出之前檢查（`usage/UsageLimitGuard`）。回 `429`，body 是
`{ "error": "USAGE_LIMIT_REACHED", "message": "這個月的轉錄已經到用量上限（600 分鐘），下個月 1 日恢復" }`，`Retry-After` 是到下個月
1 日的秒數。已經在跑的不受影響（剛上傳、還在轉錄的照樣轉錄完；上傳時自動產生的摘要與章節照樣產生），所以可能超過一點：排隊中、還沒轉錄完的檔案還沒算進用量（連續上傳靠限流擋），沒回報用量的呼叫也不算。查不到用量（ai-service 或 transcription-service 連不上）時放行並記 log，跟限流一樣。問答時的 embedding 與編輯後的重算不算在上限裡（embedding 不記用量）。

### 快取

cache-aside，存在 Redis（`cache/`）：讀的時候先查 Redis，沒有才問下游並寫回；會變的時候由寫入端刪掉。只快取「讀很多、很少變、變了知道
何時」的資料：

| 快取 | 鍵 → 值 | 寫回 | 刪掉 | 有效時間 |
|---|---|---|---|---|
| Job 的擁有者（`JobOwnerCache`） | `job-owner:{jobId}` → 使用者 id（或「已刪除」） | `JobOwnershipGuard` 向 upload-service 確認過（`GetJob` 成功）之後；已經標記刪除的不寫 | `DELETE /jobs/{jobId}` 成功之後改成「已刪除」的標記 | 10 分鐘（`CACHE_JOB_OWNER_TTL`） |

每個 Job 的 API（逐字稿、摘要、章節、問答、測驗、會後處理、用量……）都要先確認 Job 是這位使用者的，前端每 3～4 秒輪詢一次；記住之後不用
每次都呼叫 upload-service。記住的擁有者不是這位使用者就直接回 404（跟 upload-service 一樣，不透露 Job 存在）；找不到的 Job 不記（不做
negative cache）。只記擁有者、不記會變的 Job 狀態——`GET /jobs/{jobId}` 與需要 Job 內容的呼叫（`JobOwnershipGuard.fetch`，例如會後處理
要上傳時間）照樣問 upload-service。鍵用正規化的 UUID（大小寫不同是同一個鍵），不是 UUID 的不記。Redis 連不上、或存的值看不懂時當作
沒記住（跟限流一樣，`redis/RedisFallback`）。

刪除時寫「已刪除」的標記而不是刪掉鍵：刪除之前就在路上的請求晚一步寫回擁有者時（Lua 原子地判斷），標記在就不寫——否則被刪掉的 Job
又會被當成還在，而刪除目前不會通知 ai-service 與 transcription-service（它們的資料還在），擁有者就還讀得到、還能觸發付費的 AI 功能。
Job id 是 UUID、不會重用，標記在有效時間內直接回 404。有效時間是保險，也限制了「刪除時 Redis 剛好連不上、標記沒寫成」最多多久
（10 分鐘，這段時間只有原本的擁有者讀得到）。

### 刪除帳號之後

access token 是 stateless 的，帳號刪掉之後最多還能用到過期（15 分鐘）——其他分頁或裝置照樣能呼叫 API，甚至建出新的 Job、留下沒人刪的資料。
所以刪除成功後在 Redis 記 `deleted-user:{id}`（有效時間＝access token 的有效時間，`security/DeletedUsers`），`JwtAuthenticationFilter` 驗完 token
再查它，有就回 `401`。**Redis 連不上時放行**（跟限流、快取一樣），那段時間舊 token 照樣能用到過期。

### 錯誤格式

下游 gRPC 呼叫失敗時（`GrpcExceptionAdvice`），統一轉成：

```json
{ "error": "NOT_FOUND", "message": "job not found" }
```

對應表：`INVALID_ARGUMENT`→400、`UNAUTHENTICATED`→401、`PERMISSION_DENIED`→403、`NOT_FOUND`→404、`ALREADY_EXISTS`/`FAILED_PRECONDITION`→409、`UNAVAILABLE`（下游服務沒開/連不上）→503，其餘→500。JWT 驗證失敗（缺 header、簽章錯、過期）直接在 filter 層回 401，不會走到這裡。超過限流是 429（見上方「限流」）。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `APP_ENV` | `development` | `production` 時檢查密鑰並關掉開發用的東西，見「正式環境」 |
| `JWT_SECRET` | `dev-only-shared-secret-change-me-before-any-real-deployment` | HS256 驗章密鑰，**必須跟 auth-service 的 `JWT_SECRET` 一致** |
| `AUTH_SERVICE_GRPC_TARGET` | `localhost:9091` | auth-service |
| `UPLOAD_SERVICE_GRPC_TARGET` | `localhost:9090` | upload-service |
| `TRANSCRIPTION_SERVICE_GRPC_TARGET` | `localhost:8083` | transcription-service |
| `AI_SERVICE_GRPC_TARGET` | `localhost:8084` | ai-service |
| `OAUTH_CALLBACK_BASE_URL` | `http://localhost:5173/api` | 已連結的帳號：Google / Notion 回呼的是 `{這個}/oauth/{service}/callback`（要登記在 Google 的 OAuth client）；本地開發時瀏覽器經過 Vite 的 `/api` proxy 到 Gateway |
| `FRONTEND_URL` | `http://localhost:5173` | 連結完成（或失敗）後把使用者轉回 `{這個}/settings` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` / 空 | 限流與快取用的 Redis（k8s 裡 `REDIS_PORT` 一定要設，否則會被 k8s 自動注入的 `tcp://…` 蓋掉） |
| `REDIS_TIMEOUT` / `REDIS_CONNECT_TIMEOUT` | `500ms` | Redis 慢或連不上時多久放棄（放棄時限流放行、快取當作沒記住） |
| `RATE_LIMIT_LOGIN_FAILURES`、`RATE_LIMIT_LOGIN`、`RATE_LIMIT_REGISTER`、`RATE_LIMIT_PER_USER`、`RATE_LIMIT_PER_ADDRESS`、`RATE_LIMIT_UPLOAD_URL`、`RATE_LIMIT_UPLOAD`、`RATE_LIMIT_QUESTION`、`RATE_LIMIT_QUIZ`、`RATE_LIMIT_REGENERATE`、`RATE_LIMIT_POST_MEETING`、`RATE_LIMIT_PROVIDER_KEY`、`RATE_LIMIT_TRANSCRIPT_EDIT`、`RATE_LIMIT_LINKED_SERVICE`（與各自的 `_WINDOW`） | 見「限流」的表 | 限流的上限與時間長度 |
| `CACHE_JOB_OWNER_TTL` | `10m` | Job 擁有者快取的有效時間，見「快取」 |
| `USAGE_LIMIT_TRANSCRIPTION_MINUTES` / `USAGE_LIMIT_PLATFORM_TOKENS` / `USAGE_LIMIT_WEB_SEARCHES` | `600` / `2000000` / `30` | 每月用量上限，見「每月用量上限」 |
| `FORWARD_HEADERS_STRATEGY` / `TRUSTED_PROXIES` | `none` / 空 | 取得來源 IP 的方式與信任的反向代理，見「限流」 |
| `REFRESH_COOKIE_PATH` / `REFRESH_COOKIE_SECURE` | `/api/auth` / `true` | refresh token 的 cookie，見「refresh token 的 cookie」 |
| `JWT_REFRESH_TOKEN_TTL_DAYS` | `7` | refresh token 的 cookie 多久過期（跟 auth-service 讀同一個變數） |
| `JWT_ACCESS_TOKEN_TTL_MINUTES` | `15` | 剛刪除帳號的使用者記多久（跟 access token 一樣長，跟 auth-service 讀同一個變數），見「刪除帳號之後」 |

## 專案結構

```
src/main/java/com/transuai/gateway/
  config/            GrpcClientConfig（4 個 ManagedChannel + blocking stub bean）、GrpcProperties、WebConfig
  security/           JwtProperties、JwtService（只驗證 access token）、JwtAuthenticationFilter、InvalidTokenException、RefreshTokenCookie、DeletedUsers（剛刪除帳號的使用者）
  web/                CurrentUserId annotation + CurrentUserIdArgumentResolver、AuthController、UploadController、
                       TranscriptionController、AiController、QuizController、UsageController、ModelController、
                       ProviderKeyController、ConnectionController、PostMeetingController
  web/dto/            REST 用的 JSON DTO（跟 proto message 分開，不直接把 protobuf 型別序列化給前端）
  web/advice/         GrpcExceptionAdvice（StatusRuntimeException → HTTP status + JSON error body；RateLimitedException → 429）
  cache/              JobOwnerCache（Job 的擁有者，cache-aside）
  redis/              RedisFallback（Redis 連不上時照常服務）
  usage/              MonthlyUsage（某個月的用量，向 ai-service 與 transcription-service 查）、UsageLimits、UsageLimitGuard、UsageLimitReachedException
  ratelimit/          RateLimiter（Redis 固定視窗計數器，連不上放行）、RateLimitProperties、AuthRateLimits（登入與註冊）、
                       ApiRateLimits（所有 API 與花錢的功能）、CostlyFeature（標在 controller 方法上）、RateLimitedException
  grpc/               GrpcMetadataSupport（組 x-user-id metadata）、JobOwnershipGuard（Transcription/AI 端點的 ownership 檢查）、
                       GrpcTimestamps、GrpcStrings（空字串 → null）、UploadMapper（proto ↔ DTO）
```

## 正式環境（`APP_ENV=production`）

`APP_ENV` 預設是 `development`；設成 `production`（Java 服務用 `spring.profiles.active=${APP_ENV:development}`，就是 `production` profile）時：

- 啟動前檢查密鑰（`config/ProductionSecretsCheck`）：`JWT_SECRET`（至少 32 字元）、`REDIS_PASSWORD` 沒設、還是開發用的預設值（`0000`、`admin`、`dev-only-…` 這類，跟 `infra/k8s/02-secret.yaml` 一致）、
  或少於 12 字元，就不啟動，錯誤訊息列出是哪幾個環境變數。
- API 文件（Swagger UI、`/v3/api-docs`）不對外（`application-production.properties`）。

開發環境都不檢查、照舊開著。見 `.scratch/pre-launch-hardening/issues/07`。

## 依賴套件弱點掃描

掃 build 出來的 Spring Boot jar（裡面就是正式執行時的所有依賴），用 [Grype](https://github.com/anchore/grype)（Docker 跑，不用安裝）對照 GitHub
Advisory 等弱點資料庫：

```bash
./gradlew bootJar -x test
docker run --rm -v grype-db:/root/.cache/grype -v "$PWD/build/libs/gateway-0.0.1-SNAPSHOT.jar:/scan/app.jar:ro" anchore/grype:latest file:/scan/app.jar
```

沒用 OWASP Dependency-Check：它要先下載 NVD 全部資料（沒有 NVD API key 時很慢），而且靠 CPE 比對、誤報多；Grype 直接認 jar 裡的套件座標。
上線前、以及之後每個月或升級依賴時跑一次。高風險、嚴重的要升級，或在這裡寫清楚為什麼不影響。

Spring Boot 管理的版本跟不上弱點修正時，在 `build.gradle` 用 `ext['…version']` 覆蓋（目前覆蓋 Jackson、Tomcat、RabbitMQ amqp-client，
見 `build.gradle` 的註解）；升級 Spring Boot 之後它管理的版本追上了，就拿掉對應的覆蓋。

最近一次結果：2026-10-03：Spring Boot 4.1.0 → 4.1.1 加上覆蓋之後沒有已知弱點（原本有 Tomcat 的嚴重弱點，以及 Netty、Jackson 的高風險弱點，都是 Spring Boot 管理的傳遞依賴）。

## 已知限制 / 待辦

- **Transcription / AI 這幾個端點的 ownership 檢查在 Gateway**：`transcription-service` 的 `GetTranscript`、`ai-service` 的 `GetSummary`/`ListChapters`/`AskQuestion`/`ListQaHistory` 本身還是不驗證 `x-user-id`（只驗 job_id 存不存在，見兩邊 proto 的註解；`AskQuestion` 的 `user_id` 只用來記錄 `qa_history`，不重新驗證），Gateway 在轉發前先確認 ownership（`JobOwnershipGuard`，別人的 job 回 404）：擁有者記在 Redis（見「快取」），沒記住時才呼叫 `upload-service` 的 `GetJob`
- 每月用量上限用的是已記錄的用量加上這次檔案的長度（前端量的，可能不準）：排隊中、還沒轉錄完的檔案還沒算進去，可能超過上限一點（見「每月用量上限」）
- access token 在 gateway 本地驗章，登出後仍有效到過期（最多 15 分鐘）；要立即失效得每個請求回頭問 auth-service，目前不做
- `POST /qa/{jobId}` 的 `SseEmitter` 沒設 timeout（`new SseEmitter(0L)`），串流時間完全取決於 LLM 生成速度；如果下游 Groq 呼叫本身卡住不回應，這個連線會一直開著直到客戶端斷線，沒有額外的伺服器端逾時保護（見 [`../docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](../docs/adr/0001-sse-via-gateway-for-streaming-qa.md)）
- 測試只涵蓋限流、每月用量上限與快取（`./gradlew test`，Spring Boot test + MockMvc，下游 gRPC 用 `@MockitoBean` 換掉，Redis 用 Testcontainers 起臨時容器，
  要有 Docker）；其他端點仍靠手動 smoke test（curl 跑過 register → login → me → presign → list jobs 全流程，以及 400/401/404/503 各種錯誤情境）
