# ADR 0001: 用訊息層級 requeue 處理暫時性外部失敗，而不是 in-process 重試

## Status

Accepted

## Context

`ai-service` 的訊息處理（`pipeline.py`）在單一 consumer thread 內同步跑完一則 `transcription.completed` 訊息：讀取逐字稿、呼叫 Groq 產生摘要/章節、呼叫 HF 產生 embedding、寫入資料庫、回報 Job 狀態。目前任何一步失敗（包含外部 API 暫時性的 429/503），整個 Job 立即被判定為 `FAILED`，使用者只能重新上傳整個檔案才能重跑。

要解決這個問題，需要在暫時性失敗（Groq rate limit、HF 過載、內部 gRPC 服務短暫不可用）時自動重試。有三種可行的重試機制：

1. **In-process blocking retry**：在呼叫失敗時，於同一個 consumer thread 內 `sleep()` 後重打，訊息最後才 ack。
2. **訊息層級 requeue（本 ADR 採用）**：失敗時把訊息發到一個有 TTL 的 retry queue，TTL 到期後透過 dead-letter-exchange 自動送回原 queue 重新被消費，訊息立即 ack（原始那份）。
3. **`rabbitmq-delayed-message-exchange` plugin**：發布訊息時帶一個延遲時間，plugin 負責到時間才真的送達。

## Decision

採用選項 2：訊息層級 requeue，用兩條各自帶固定 `x-message-ttl` 的 retry queue（2 秒、4 秒），dead-letter-exchange 指回原本的處理 queue。（後續：ai-service 消費的 queue 不只一個之後，改成**每個被消費的 queue 各有自己的一組** `<queue>.retry.2s`／`.4s`，重試才會回到同一個處理函式；見 `app/services/retry.py` 的 `retry_queue_declarations()`。）重試次數上限 3 次（1 次原始 + 2 次重試），透過訊息 header 追蹤，超過上限走現有的 FAILED 路徑。

Consumer 端的 `prefetch_count=1` 決定了同一時間只有一則訊息在被處理——這個決定本身沒有改變；改變的是「一則訊息處理失敗後，等待重試的時間」不再佔用 consumer thread。

## Consequences

**接受的取捨**：訊息重新被消費時，是被當成全新訊息處理——整個 pipeline 從頭重跑，包括已經成功過的呼叫（例如摘要已經生成，但 embedding 失敗，重跑會重新呼叫一次摘要）。這是刻意接受的成本：一來 Groq 免費層額度寬鬆（README 就是因為這個才從 Gemini 換過來的）；二來目前沒有任何一步的中間結果會被存進資料庫（`save_summary`/`save_chapters`/`save_embeddings` 都在三個呼叫都成功之後才一起呼叫），沒有部分進度可以保留，做「只重試失敗的那一步」的複雜度換不到實際好處。

**為什麼不選 in-process retry**：`prefetch_count=1` 代表重試期間的 `sleep()` 會讓整個 consumer thread 卡住，下一則訊息完全無法被消費，即使那則訊息跟目前正在重試的訊息毫無關係。重試次數多、延遲時間長時，這個排隊效應會被放大。訊息層級 requeue 把「等待」還給 RabbitMQ 自己管理，consumer thread 在等待期間可以繼續處理其他訊息。

**為什麼不選 delayed-message-exchange plugin**：`infra/docker-compose.yaml` 跟 `infra/k8s/12-rabbitmq.yaml` 目前都是原生 `rabbitmq:3-management-alpine`，沒有裝這個 plugin。要用它必須改動這兩份設定——這是跨服務共用的 RabbitMQ broker 設定，影響範圍超出 `ai-service` 自己的 repo，對於「一個服務的重試策略」這件事是不成比例的基礎建設投入。TTL + DLX 的做法完全靠 `ai-service` 自己在 `consumer.py` 裡宣告 queue 就能做到，不用碰共用設定。

**已知限制**：queue-level TTL（而不是 per-message TTL）用來避免 RabbitMQ 「per-message TTL 只在訊息排到 queue 頭部時才會真的過期」的已知行為——但這代表兩條 retry queue 的延遲是固定的，不能做到每則訊息各自不同的延遲時間。這裡不需要，因為延遲時間本來就是依重試次序（第一次重試 2 秒、第二次 4 秒）決定，不是依訊息內容決定。

**遺留的地基**：這個機制（可重試例外型別、requeue queue、header 追蹤、路由決策）是為 Groq/HF 呼叫（`ai-service-groq-hf-retry`）建的，但刻意設計成可以被其他呼叫點複用——`ai-service-grpc-resilience` 這份 spec 就是直接重用同一套機制,只是換一套「這個例外算不算可重試」的分類邏輯（gRPC status code 而不是 Groq/HF SDK 例外型別）。
