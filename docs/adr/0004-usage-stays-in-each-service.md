# ADR 0004: 用量記在產生它的服務裡，由 Gateway 合併

## Status

Accepted（2026-09-26）

## Context

使用者要看到每一次計費呼叫的**用量**（見 `ai-service/CONTEXT.md`）：LLM 呼叫的 token 數由 ai-service 產生，轉錄的音檔秒數
由 transcription-service 產生。Job 工作區要一起列出來，之後設定頁還要依月份彙總。

可以的做法：

1. 各服務記在自己的資料庫，查詢時由 Gateway 分別呼叫再合併。
2. 各服務透過 MQ 發「用量已記錄」事件，由其中一個服務集中存放。
3. 新開一個專門的用量服務。

## Decision

採用 1：ai-service 寫 `ai_db.llm_usage`，transcription-service 寫 `transcription_db.transcription_usage`，各自提供
`ListJobLlmUsage` / `ListJobTranscriptionUsage`；Gateway 的 `GET /jobs/{jobId}/usage` 兩邊都查、依時間排序後合併並加總。

- 符合「每個服務一個資料庫」（架構文件 2.1）：用量跟產生它的呼叫在同一個服務、同一個時間點寫入，不經過 MQ，不會因為
  訊息遺失而少記，也不用處理重複投遞。
- 每筆用自己的 session 立即寫入，跟呼叫它的流程（存摘要、存逐字稿）是分開的交易：流程後面失敗，用量照樣留下。寫不進去
  只記 log，不讓 Job 失敗——少一筆紀錄比整個 Job 失敗好。

## Consequences

- 兩個服務的資料結構相似但分開維護（LLM 是 token，轉錄是秒數），Gateway 的 DTO 用 `kind` 區分。
- 查詢要打兩個服務；任一個掛掉時整個用量查詢失敗（不是只少一半），前端保留畫面上既有的內容。
- 之後的彙總（每月、依模型）一樣各自提供、由 Gateway 合併，不需要跨資料庫查詢。
- 如果之後要做每人用量上限，判斷點會分散在兩個服務；到時候再評估要不要集中。
