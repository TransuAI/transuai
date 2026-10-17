# 刪除事件用 fanout exchange 發給各服務，並經 outbox 送出

刪除一個 Job（之後還有刪除帳號）時，transcription-service 與 ai-service 也要清掉自己手上的資料。我們讓 upload-service 發
`job.deleted { jobId, userId }` 到一個 **fanout exchange**，每個要清資料的服務綁一個自己的佇列（`job.deleted.transcription`、
`job.deleted.ai`），而不是 Gateway 刪完之後同步呼叫每個服務。事件跟刪除寫在**同一個資料庫交易**的 outbox（`upload_db.outbox_events`），
由排程等 broker 確認收到（publisher confirm）才刪掉那一筆。理由：同步呼叫在某個服務暫時掛掉時會刪到一半；事件讓每個服務自己做完、
失敗自己重試。outbox 保證「資料刪了、事件一定送出」——直接在 commit 之後發，broker 剛好連不上就漏了，而刪除漏掉是個資問題。

## Consequences

- 第一次用 fanout exchange：其他事件都是預設 exchange、一個佇列一個消費者（一對一）。刪除事件天生是一對多；`account.deleted`（auth-service 經自己的
  outbox 發，upload-service、ai-service、transcription-service 各綁一個佇列）也是同一套；
  新的服務要清資料就綁一個新佇列，發送端不用改。
- 至少送一次、可能重複：消費者都要能重複處理（刪不存在的東西不算錯）。
- 處理失敗（例如資料庫連不上）不限次數重試：nack 到 `<queue>.retry`（30 秒後 dead-letter 回來）。不像 pipeline 的重試（最多 3 次）——
  刪除一定要做完；訊息本身不合法才丟掉。消費刪除事件的是另一條 thread、另一條連線，不排在好幾分鐘的轉錄或摘要後面。
- 刪除當下還在跑的寫入（轉錄、摘要、出題、問答……）可能比刪除晚寫進來。兩個服務收到事件時先記下 `deleted_jobs`（保留一天）再刪資料，
  寫入在 commit **之後**查它（ai-service 用 session 的 hook 統一處理，transcription-service 只有兩個寫入點、直接呼叫）。只在寫入前查會有空窗。
- 用量紀錄不跟著 Job 刪：月用量不能因為刪 Job 變少（刪帳號時才去識別化）。
