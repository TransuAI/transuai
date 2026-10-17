# Context Map

## Contexts

- [AI Service](./ai-service/CONTEXT.md) — 摘要生成、章節分段、embedding、RAG 問答（對話記憶、streaming）
- [Frontend](./frontend/CONTEXT.md) — 使用者介面、Job 工作區、匯出
- [Transcription Service](./transcription-service/CONTEXT.md) — 轉錄、逐字稿與其編輯、講者分離
- [Upload Service](./upload-service/CONTEXT.md) — 上傳、Job 的紀錄、標題與類型、Job 列表

其餘服務（`auth-service`、`gateway`、`infra`、`notification-service`）目前還沒有自己的 `CONTEXT.md`——依
`docs/agents/domain.md`，這些會在對應 context 真的有詞彙需要釐清時才建立，不會預先生成空殼。

## Relationships

- **AI Service → Gateway**：Gateway 透過 gRPC 查詢摘要/章節/問答（含 streaming），`AiService`
  本身不驗證使用者身份，由 Gateway 的 ownership 檢查把關。
- **Transcription Service → AI Service**：透過 MQ 事件單向通知——`transcription.completed`
  觸發 AI pipeline；`transcript.edited` 通知逐字稿被編輯，ai-service 據此重算文字有變的片段的
  embedding（見 `docs/adr/0003-transcript-edits-propagate-via-mq-event.md`）。摘要/章節是否過時由
  逐字稿版本號與摘要記錄的依據版本比較得出。ai-service 需要逐字稿內容時一律回頭呼叫
  `GetTranscript`，事件本身不帶逐字稿內容。
- **用量**：LLM 呼叫的用量存在 ai-service、轉錄用量存在 transcription-service，各自記在自己的資料庫；要顯示時由
  Gateway 分別查詢再合併，兩個服務之間不互相傳用量（見 `docs/adr/0004-usage-stays-in-each-service.md`）。

