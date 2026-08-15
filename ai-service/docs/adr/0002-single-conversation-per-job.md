# ADR 0002: 對話記憶的範圍是整個 job，不做獨立的 conversation/thread

## Status

Accepted

## Context

問答功能要加上對話記憶：追問時 LLM 要看得到這個 job 底下之前問過的問題跟答案。`qa_history`
表原本只寫入、沒有對應的查詢 RPC（見表定義的註解），現在要補上讀取路徑，順便決定資料要怎麼分組。

有兩種可行的資料模型：

1. **單一連續對話（本 ADR 採用）**：一個 job 底下所有問答共用同一段記憶，`qa_history` 只要
   `job_id` 就能定位一段完整的對話，跟現在的 schema 完全相容，不用加欄位。
2. **多個可命名的對話串**：使用者可以在同一個 job 底下開新對話、清掉記憶重來，`qa_history`
   要加一個 `conversation_id`（或 `thread_id`）欄位分組，前端要有對話列表、切換、命名的 UI。

## Decision

採用選項 1：一個 job 只有一段連續對話，沒有獨立的 conversation/thread 概念。`ListQaHistory`
RPC 依 `job_id` 撈出這個 job 的全部問答，依 `created_at` 升冪排序回傳；`AskQuestion` 做記憶
時，同樣依 `job_id` 撈最近幾輪當作對話歷史餵給 LLM。`qa_history` 表結構不變。

## Consequences

**為什麼不做多對話串**：目前沒有任何使用情境需要「同一個 job 開兩個獨立對話」——一個 job 對應
一份逐字稿，使用者針對這份逐字稿提問，自然就是一段連續的脈絡。多對話串會多一層 UI（列表、切換、
命名）跟一個新欄位，換不到目前看得到的好處。

**之後要加會需要 migration**：如果之後真的要支援多對話串，`qa_history` 要加
`conversation_id`（既有資料要決定怎麼回填——例如整批視為每個 job 的「預設對話」），
`ListQaHistory`/`AskQuestion` 的 proto 都要加這個欄位，前端也要重做對話記憶的 UI。這是刻意
接受的技術債：現在把資料模型做複雜是在為一個還沒出現的需求付成本。
