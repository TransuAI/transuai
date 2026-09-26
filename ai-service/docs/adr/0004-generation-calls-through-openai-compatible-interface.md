# ADR 0004: 生成類呼叫一律走 OpenAI 相容介面

## Status

Accepted（2026-09-26）。部分取代 ADR 0003：平台模型仍然是 HF Inference Providers 上的同一個聊天模型，但生成類呼叫
不再透過 `huggingface_hub` 的 `InferenceClient`，改走 HF 的 OpenAI 相容路由。embedding 不受影響，仍用 `InferenceClient`。

## Context

`model-selection-and-usage` spec 要讓使用者用自己的金鑰呼叫 OpenAI、Anthropic、Google Gemini、OpenRouter（自有金鑰），
加上原本的平台模型，總共五家。每一家都要支援一般回應與串流，並取得廠商回報的 token 用量（用量記錄），錯誤也要分成
「暫時性（交給訊息層級重試）」與「永久性（直接失敗並說明原因）」。

每家各自接官方 SDK 等於把串流、用量解析、錯誤分類寫五遍。而這五家都提供 OpenAI 相容的 chat completions 端點：
OpenAI、OpenRouter 本來就是；HF Inference Providers 有 `https://router.huggingface.co/v1`；Gemini 與 Anthropic 都有官方的
OpenAI 相容端點。

## Decision

所有生成類呼叫（摘要、章節、問答、問題改寫，以及之後的測驗與會後處理）都透過一個 OpenAI 相容 client
（`openai` SDK，依廠商換網址與金鑰），集中在 `app/services/llm_client.py`：

- 回傳文字與 token 用量；串流時要求 `stream_options.include_usage`，廠商沒回報就是未知，不估算。
- 廠商錯誤一律轉成 `LlmError`，標明廠商、模型與原因：429 與 5xx、逾時、連不上是暫時性（OpenAI 以 429 +
  `insufficient_quota` 回報的餘額不足除外，那是永久性的額度不足）；401、403 是金鑰問題；402 是額度；404 是模型不存在。
- SDK 自己的重試關掉（`max_retries=0`），重試一律走既有的訊息層級機制（ADR 0001）。
- 平台模型走 HF 的 OpenAI 相容路由，照樣帶上關閉 thinking mode 的 `chat_template_kwargs`。2026-09-26 實測：路由會把它
  原樣轉給模型（回應沒有 reasoning 內容），一般回應與串流都會回報 token 用量。

## Consequences

- 串流、用量、錯誤分類只寫一套，新增廠商只要多一組網址與金鑰。
- Anthropic 的 OpenAI 相容端點比它自己的 API 少一些功能（例如部分快取與進階工具參數）；摘要、問答、測驗用不到。之後
  會後處理需要工具呼叫時，要逐家確認相容端點支援到什麼程度。
- `openai` SDK 3.x 底層改用 `httpx2`（不是 `httpx`）。測試用的假 AI 廠商因此用 `httpx2.MockTransport` 注入。
- 平台模型能用的 provider 仍由 HF 路由自動挑選，ADR 0003 關於「provider 承載會隨時間變動」的風險不變。
