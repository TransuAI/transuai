# ADR 0001: 問答 streaming 走 Gateway 用 SSE，不是 WebSocket、也不讓前端直連 ai-service

## Status

Accepted

## Context

問答功能（`POST /qa/{jobId}`）原本是一次性的請求/回應：前端送出問題，等 Gateway 轉發 gRPC unary
`AskQuestion` 呼叫完成、拿到完整答案才回傳。要做成 ChatGPT 那種逐字跑出來的體驗，答案要用
streaming 方式即時往前端推。

`ai-service` 是純內部服務，只講 gRPC，沒有對外的 HTTP/WS server；平台裡唯一一個直接對前端開放
（繞過 Gateway）的內部服務是 `notification-service`（見 `notification-service/README.md`），
而且那是因為它的性質是「推播」（Job 狀態變化，服務端主動通知，不是回應查詢），架構文件本來就把
它列為唯一的例外，其餘查詢一律經 Gateway 轉發（`infra/architecture-design.md` 3.5）。問答則相
反：使用者送出問題後才有回應，本質上仍是一次查詢，只是回應方式改成 streaming。

有三個可行做法：

1. **SSE 經 Gateway（本 ADR 採用）**：`AskQuestion` 改成 gRPC server-streaming，Gateway 用
   `SseEmitter` 把 gRPC stream 轉成 SSE 往前端推，`POST /qa/{jobId}` 維持現有路徑跟方法，只是
   回應變成 `text/event-stream`。
2. **WebSocket 經 Gateway**：同樣把 gRPC 改成 streaming，但前端跟 Gateway 之間走 WS。
3. **前端直連 ai-service**：幫 ai-service 加一個新的 HTTP/WS 層，繞過 Gateway。

## Decision

採用選項 1：SSE 經 Gateway。

- 問答的資料流是單向（伺服器 → 前端），不需要 WS 的雙向通道；`SseEmitter` 是 Spring MVC
  （`spring-boot-starter-webmvc`）內建的類別，不需要把 Gateway 換成 WebFlux 才能用。
- 維持「查詢一律經 Gateway 轉發」的既有原則：`JobOwnershipGuard` 的 ownership 檢查邏輯留在
  Gateway 一份就好，不用在 ai-service 端重新實作一次（ai-service 本來就不驗證
  `x-user-id`，見 `infra/proto/ai.proto` 的註解）。
- gRPC 層改成 `rpc AskQuestion(AskQuestionRequest) returns (stream AskQuestionChunk)`：
  `AskQuestionChunk` 是一個 `oneof`（`sources` / `delta` / `error`），對應 SSE 的三種
  event。Gateway 用 blocking stub 拿到的 `Iterator<AskQuestionChunk>`，同步先取第一個
  chunk（一定是 `sources`，見 proto 註解）——這一步是唯一還會讓 `StatusRuntimeException`
  往外冒的時機點（例如這個 job 還沒有 embedding 對應的 `NOT_FOUND`），讓它照舊走
  `GrpcExceptionAdvice` 轉成一般的 JSON 錯誤 response，而不是包成 SSE error event（這時候
  HTTP response 都還沒開始送，還來得及回一個正常的錯誤 status）。拿到第一個 chunk 之後才
  正式建立 `SseEmitter`、開一個 virtual thread 把剩下的 chunk 逐一轉送。
- 前端不用瀏覽器原生的 `EventSource`：這個 API 全部端點都是 Bearer JWT 驗證，`EventSource`
  沒辦法附加自訂 header，只能自己用 `fetch()` + `ReadableStream` 手動解析 SSE frame（見
  `frontend/src/lib/api-client.ts` 的 `requestSse`）。

## Consequences

**為什麼不選 WebSocket**：問答本質上還是「一問一答」的查詢，不需要 WS 提供的雙向通道；改用 WS
換不到實際好處，卻要多處理連線生命週期管理（重連、心跳）跟前端 WS 訊息路由（同一個 WS 連線上
可能要同時處理多個 job 的問答），複雜度不成比例。

**為什麼不選前端直連 ai-service**：ai-service 目前完全沒有對外的 HTTP/WS server，也沒有驗證
`x-user-id` 的機制（信任內部網路呼叫、由 Gateway 先做 ownership 檢查）。要讓前端直連，得幫
ai-service 從零加一層 HTTP/WS server，還要把 `JobOwnershipGuard` 的邏輯複製一份過去（或改成
呼叫 upload-service）——這不只是「加一個 endpoint」，是幫一個原本刻意保持純內部的服務開一個新的
對外攻擊面，且跟 `notification-service` 是目前唯一例外的既有原則衝突。

**已知限制**：`SseEmitter(0L)` 不設 timeout，串流時間完全取決於 LLM 生成速度；如果 Groq
本身掛住不回應，這個連線會一直開著直到客戶端斷線或 Groq 逾時，目前沒有額外的伺服器端逾時保護。
