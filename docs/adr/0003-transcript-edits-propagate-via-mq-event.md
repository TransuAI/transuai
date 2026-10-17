# 逐字稿編輯透過 MQ 事件通知 ai-service，不由 Gateway 同步協調

使用者編輯逐字稿（改片段文字、清空片段、改講者）後，摘要/章節要能被判定為過時，ai-service 也要重算
**文字有變**的片段的 embedding（embedding 只依片段文字計算；講者名稱在回答當下才代入，所以改講者
不需要重算 embedding）。我們讓 transcription-service 在寫入成功後發出 `transcript.edited { jobId }` 事件，
由 ai-service 消費、自行回頭呼叫 `GetTranscript` 比對出哪些片段變了；而不是讓 Gateway 在存檔成功後
同步呼叫 ai-service。理由：維持「下游服務之間只透過 MQ 事件溝通、Gateway 只做 REST↔gRPC 轉譯與
API composition」的既有原則，並直接沿用 ai-service 已有的訊息層級重試機制（ai-service ADR 0001）。

## Consequences

- transcription-service 從「MQ 驅動 + 唯讀查詢」變成有第一支寫入 rpc 的服務。
- 存檔成功到 embedding 更新之間有幾秒的空窗，這段時間問答可能還用到舊文字——刻意接受。
- 事件只帶 `jobId`，ai-service 回頭讀逐字稿、以片段起訖時間比對出哪些片段的文字變了。
- 過時不靠事件去「打標記」：逐字稿帶一個單調遞增的版本號，摘要記錄自己依據的版本，兩者一比就知道
  是否過時——存檔當下就成立、不受事件延遲影響，也不會在「重新產生進行中又被編輯」時被誤判為最新。
