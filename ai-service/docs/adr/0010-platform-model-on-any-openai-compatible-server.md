# ADR 0010: 平台模型可以跑在任何 OpenAI 相容的伺服器（本機開發用 Ollama）

## Status

Accepted（2026-09-28）

## Context

平台模型（摘要、章節、問答，以及 ADR 0008 的會後處理平台模型）原本固定走 HF Inference Providers，用 `HF_API_KEY` 付費。
HF 免費帳號每月只有 US$0.10：開發時跑幾次會後處理就用完（實際撞到 HTTP 402），而且摘要、問答、embedding 共用同一把金鑰，
一起停擺。開發者不想為了開發測試付 AI API 的錢，他的電腦有一張 RTX 5080（16GB）。

之後上雲時，平台模型也要能選：託管 API（依用量付費）或自己架模型伺服器（例如 vLLM）。生成類呼叫本來就走 OpenAI 相容介面
（ADR 0004），Ollama、vLLM 都提供同樣的 `/v1/chat/completions`。

## Decision

- **平台模型的連線是設定**：`PLATFORM_LLM_BASE_URL`（預設 HF 路由）、`PLATFORM_LLM_API_KEY`（空的用 `HF_API_KEY`）、
  `PLATFORM_LLM_EXTRA_BODY`（每次呼叫多帶的參數，JSON）；模型名稱沿用 `AI_HF_CHAT_MODEL` 與 `AI_POST_MEETING_PLATFORM_MODEL`。
  預設值讓行為跟以前完全一樣。
- **關 thinking 的寫法是設定**：每種伺服器不同。HF 的路由與 vLLM 吃 chat template 的 `enable_thinking`（預設值）；
  Ollama 不吃，模型照樣先思考、把 token 燒光——實測 `qwen3.5:9b` 的回覆是空的——要帶 `{"reasoning_effort": "none"}`
  （實測兩個模型都不再思考，回覆 0.2～4 秒）。
- **本機開發**：用 Docker 跑 Ollama（`--gpus all`，`infra/scripts/ollama.sh`），模型存在 Docker volume；上下文長度 32K
  （1 小時的逐字稿約 2.5 萬 token），KV cache 用 q8 省顯示記憶體。k8s 裡的 pod 經由 Docker Desktop 的
  `host.docker.internal:11434` 連到它（實測連得到）。一般生成用 `qwen3.5:9b`，會後處理先用 `qwen3:14b`（實測兩個都會正確
  呼叫工具、換算相對日期），之後由實測決定（見 `.scratch/local-platform-model/issues/03`）。
- **上雲**：程式不改，只換設定——起步用託管 API（依用量付費，不用管 GPU），使用量大而穩定、或資料不能離開自己環境時，
  再在 k8s 開 GPU 節點自架 vLLM，把 `PLATFORM_LLM_BASE_URL` 指向叢集內的服務。

## Consequences

- 本機模型跑在開發者自己的電腦上，只適合開發；電腦沒開或 Ollama 沒跑時，所有用平台模型的功能都會失敗（連不上算暫時性
  錯誤，會重試再判定失敗）。
- 16GB 放不下兩個模型同時加長上下文：一般生成與會後處理用不同模型時，Ollama 會換出，第一次呼叫要多等載入時間（實測
  50～80 秒；呼叫的逾時是 300 秒）。
- 平台模型的用量照舊記在使用者名下（`provider` 是 `platform`、`model` 是 Ollama 的模型名稱），但不代表真的有花錢。
- embedding（`BAAI/bge-m3`）與轉錄（Deepgram）仍然是外部服務，不在這次的範圍。
- 模型名稱的設定沿用 `AI_HF_CHAT_MODEL`，名字裡的 HF 已經不準確；改名要動到每個部署的設定，先不改。
