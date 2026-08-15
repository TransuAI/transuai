# ADR 0003: 摘要/章節分段/RAG 問答的 LLM 呼叫從 Groq 換成 HF Inference Providers

## Status

Accepted

## Context

摘要、章節分段、RAG 問答（`summarizer.py`／`chapter_generator.py`／`qa.py`）原本都呼叫 Groq API
（`qwen/qwen3.6-27b`），embedding（`embedder.py`）則已經在用 HF Inference API 的
`BAAI/bge-m3`——這是專案更早之前從 Gemini 換過來的結果（Gemini 免費層額度太緊，embedding
一天只有 100 次請求）。

RAG 問答加上對話記憶之後（把最近幾輪歷史問答也塞進 prompt），實際撞到
`qwen/qwen3.6-27b` 免費層的硬限制：TPM（tokens per minute）只有 8000，單一請求的
prompt + 保留的 completion 預算都算在裡面，很容易就超過，回 `413 Request too large`。
第一步緩解是加兩層固定上限（歷史答案截斷、明確設定 `max_completion_tokens`，見
`qa.py` 的 `_MAX_HISTORY_ANSWER_CHARS`／`_ANSWER_MAX_TOKENS`），但這只是把發生機率降低，
沒有解決「這個免費層額度对這個功能來說太小」的根本問題。

有兩種可行做法：

1. **換 Groq 內的模型**：Groq 其他模型的免費層 TPM 高不少（例如
   `meta-llama/llama-4-scout-17b-16e-instruct` 30K TPM、`llama-3.3-70b-versatile` 12K
   TPM），只要改 `AI_GROQ_MODEL` 這個環境變數，不用動程式碼。
2. **換到 HF Inference Providers**（本 ADR 採用）：跟 embedding 共用同一個 provider、
   同一把 API key、同一個 `huggingface_hub` client，摘要/章節分段/RAG 問答全部改用
   `Qwen/Qwen3.5-9B`（chat completion，經 HF Inference Providers 自動選擇當下 live 的
   provider——目前是 together / featherless-ai / ovhcloud / deepinfra）。

## Decision

採用選項 2：全面換到 HF Inference Providers，`ai_hf_chat_model`（預設
`Qwen/Qwen3.5-9B`）取代原本的 `ai_groq_model`。`groq_client.py` 整支刪除，
`strip_thinking()`／`stream_without_thinking()`（濾掉 reasoning model 的 `<think>`
chain-of-thought）搬進 `hf_client.py`，跟既有的 embedding client 共用同一個
lazy-init 的 `InferenceClient` 實例。`retry.py` 的 `is_retryable_groq_error()`
連同 `groq` SDK 的例外分類一起移除，統一用既有的 `is_retryable_hf_error()`
（本來就是為 embedding 呼叫寫的，HF 例外階層本來就跟呼叫的是 chat 還是
feature-extraction 端點無關）。專案不再依賴 `groq` 這個 PyPI 套件。

## Consequences

**為什麼不選「換 Groq 內的模型」**：這是更小的變動，本來也是第一個考慮的選項，但選了
選項 2——理由不是選項 1 不可行，而是選項 2 額外把「摘要/章節分段/RAG 問答/embedding
全部只依賴一個免費 API 帳號」這件事做到底，減少要管理的 API key 種類跟供應商數量。
權衡是：Groq 有公開、逐模型列出的 TPM 表，換到什麼模型能拿到多少額度事前就能查到；
HF Inference Providers 的免費層限制沒有公開的固定數字，實際額度要跑了才知道，這是
刻意接受的不確定性。

**為什麼原本選 Groq、現在又換掉**：不是走回頭路——原本選 Groq 是因為它「當時」對生成類
呼叫的免費額度比 Gemini 寬鬆很多；換到 HF 是因為生成類需求變了（加了對話記憶，prompt
變大），而 HF 恰好是這個專案已經在用、且免費層限制目前實測夠用的另一個選項。這兩次換
的判斷依據都是「當下哪個免費層撐得住目前的使用量」，跟 `ai-service/README.md` 已知限制
提到的「免費額度會隨政策調整而變動」是同一種持續性風險，不是這次才有的新問題。

**已知限制**：`Qwen/Qwen3.5-9B` 目前查到 4 個 provider 在托管（together / featherless-ai
/ ovhcloud / deepinfra），HF 會自動選擇，但個別 provider 各自的實際限流數字不透明；跟
`HF_EMBEDDING_MODEL` 一樣，換 `AI_HF_CHAT_MODEL` 前建議先查
`GET https://huggingface.co/api/models/{model}?expand[]=inferenceProviderMapping`
確認狀態是 `live`。Qwen3 系列模型可能預設開啟 thinking mode，且 HF 的 chat completion
介面沒有 Groq `reasoning_format` 這種可以要求隱藏 reasoning 的請求參數，只能繼續靠
`hf_client.strip_thinking()`／`stream_without_thinking()` 的 regex 硬濾。
