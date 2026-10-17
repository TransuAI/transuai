# ADR 0015: 平台模型與 embedding 都跑在自架的 vLLM，出廠不指向任何付費服務

## Status

Accepted（2026-10-17）。取代 ADR 0010 裡「本機用 Ollama」的部分、ADR 0003 裡 embedding 走 HF Inference 的部分；ADR 0011 的模型
選擇改由本文的實測決定。

## Context

- embedding 是最後一個還走 HF Inference Providers 的呼叫（`huggingface_hub` 的 `feature_extraction`，`BAAI/bge-m3`）。HF 帳號額度
  用完時回 402，問答每一題都失敗（2026-10-17 實際發生）。
- 系統要開源、讓客戶裝在自己內部的伺服器上（2026-10-17 決定）：出廠不能帶開發者的金鑰，也不該預設連到任何付費服務；模型要能
  完全離線跑在客戶自己的 GPU 上。
- 本機開發原本用 Ollama 跑平台模型（ADR 0010、0011）。vLLM 是正式部署較常用的推論伺服器（多請求排程、OpenAI 相容的
  chat / embeddings / audio 都有），開發與部署用同一套比較單純。
- 開發機是 RTX 5080（16GB）。vLLM 早期的官方 image 沒有 Blackwell（sm_120）的 kernel；v0.31.0（2026-10-04）的官方 image 已經有
  （`torch.cuda.get_arch_list()` 含 `sm_120`，CUDA 13.0），本機實際跑得起來。

## Decision

- **embedding 走 OpenAI 相容的 `/v1/embeddings`**（`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`），用 `openai` SDK、
  經過對外連線的允許清單（伺服器的網域自動加入）。移除 `huggingface_hub`。錯誤轉成 `EmbeddingError`，429／5xx／逾時／連不上算暫時性，
  沿用訊息層級的重試。輸出不是 1024 維就拒收（向量欄位是 `Vector(1024)`）。
- **模型：`Qwen/Qwen3-Embedding-0.6B`**（1024 維、instruction-aware）。問題前面加 `EMBEDDING_QUERY_INSTRUCTION`（格式
  「Instruct: …\nQuery:…」），文件不加。
- **出廠什麼都不設**：`PLATFORM_LLM_BASE_URL`、`PLATFORM_LLM_MODEL`、`EMBEDDING_*` 預設都是空的。沒設平台模型時呼叫會說「平台模型
  尚未設定」（`LlmErrorReason.NOT_CONFIGURED`，不重試）；沒設 embedding 時 pipeline 不算向量、Job 照樣完成，問答只根據摘要與章節
  回答，決策搜尋只比字面。`AI_HF_CHAT_MODEL` 改名 `PLATFORM_LLM_MODEL`（舊名照樣認得）；平台金鑰不再沿用 `HF_API_KEY`。
- **換 embedding 模型自動重算**：`embedding_state` 記下現有向量是哪個模型算的（migration 0032：有向量的舊資料記成 `BAAI/bge-m3`）。
  ai-service 啟動時在背景比對：換了模型就把每個 Job 的片段（讀最新的逐字稿）與每個決策重算，全部成功才記下新模型（失敗下次啟動
  整批重來）；沒換就補算缺的（沒設定 embedding 那段時間處理完的 Job、沒有向量的決策）。多副本用 advisory lock，只有一個做。
- **本機用 `infra/scripts/vllm.sh` 起三個 vLLM**，Ollama 拿掉：

  | 服務 | 模型 | 埠 | `--gpu-memory-utilization` | 備註 |
  |---|---|---|---|---|
  | embedding | `Qwen/Qwen3-Embedding-0.6B` | 8001 | 0.12 | `--runner pooling --convert embed`，`--max-model-len 2048` |
  | 語音辨識 | `MediaTek-Research/Breeze-ASR-25` | 8002 | 0.16 | 權重 fp8（1.5GB）、`--enforce-eager`、一次一段；transcription-service 之後改用它 |
  | 聊天（平台模型、會後處理） | `Qwen/Qwen3-8B-AWQ` | 8000 | 0.53 | `--max-model-len 28672`、KV cache fp8、`--tool-call-parser hermes` |

## 實測（RTX 5080，2026-10-17）

**顯示記憶體**（`nvidia-smi`，整張 16,303 MiB；Windows 桌面本身約 1.8GB）：

| 狀態 | 用量 |
|---|---|
| 什麼都沒跑 | 約 1,800 MiB |
| + embedding | 約 4,000 MiB（embedding 約 2.2GB） |
| + 聊天（0.62、40960 context、沒有語音辨識） | 14,604 MiB（KV cache 3.44GiB＝50,048 token） |
| 改成三個一起（聊天 0.53、28672 context） | 14,960 MiB（聊天的 KV cache 2.0GiB＝29,184 token） |
| 三個同時忙（90 秒語音辨識＋2.66 萬 token 的摘要＋5 批 64 段的 embedding） | 尖峰 15,745 MiB，三個都成功、沒有一個掛掉 |

- 語音辨識的 CUDA graph 要多 4.8GB，不錄（`--enforce-eager`）才放得下；fp16 權重（3.1GB）也放不下，用 fp8。
- 聊天：2.66 萬 token 的逐字稿（約一小時）摘要 8 秒。超過 28672 的請求 vLLM 直接回 400，不會把記憶體撐爆。
- 語音辨識：90 秒的英文會議 12.8 秒辨識完，回傳片段的起訖時間（`verbose_json`、`timestamp_granularities[]=segment`）；每次重開後的第
  一個請求要暖機（約 100 秒）。一小時的錄音約 8～9 分鐘。
- **會後處理**（ADR 0011 那套實測，三段真實會議各兩次，vLLM 上的 `Qwen/Qwen3-8B-AWQ`）：6／6 跑完、每次都有提案（2～4 個），7～39 秒。
  工具參數都合法、沒有解析失敗。行事曆活動多半是 ADR 0013「約好的會議」那一次呼叫提的（這也是 8B 回答的）：臺大那段的「3 月 24 日
  上午臨時校務會議」兩次都有。弱點：有一次提了兩個一模一樣的活動、有一次沒有 Notion 會議紀錄、報告型的會議（臺中市政會議）把宣傳
  活動提成行事曆（`qwen3:14b` 也一樣）。品質跟 ADR 0011 的 `qwen3:14b` 相當，提案一律要使用者確認才執行（ADR 0007）。

## Consequences

- 開發不用任何付費 AI 服務；HF 帳號額度與 402 不再影響問答。部署的人要自己準備 GPU 與模型（或指向自己選的 OpenAI 相容服務）。
- 16GB 的餘裕只剩約 0.5GB：開著吃顯示記憶體的 Windows 程式（遊戲、瀏覽器的硬體加速）有機會讓之後啟動的 vLLM 起不來（已經起來的不受
  影響，它們先佔好了）。調 `vllm.sh` 的環境變數可以換配置；沒有語音辨識時聊天可以給到 0.62／40960。
- **27B 等級放不下**：`Qwen3.8-27B` 是 27B 的 dense 模型，4-bit 也要約 17GB，比整張 16GB 還大。要用它得換 24GB 以上的卡（32GB 的
  RTX 5090 才放得下它加 embedding 與語音辨識），或改走自有金鑰的雲端模型。
- 每次換聊天模型都要用 ADR 0011 的會後處理實測重跑（`.scratch/local-platform-model/bakeoff/`，`BAKEOFF_BASE_URL` 指向 vLLM）。
- 換 embedding 模型後，重算完成前還沒輪到的 Job 找段落不準；本機 18 個 Job、5 個決策約 5 秒算完。
- 講者分離 vLLM 不提供：transcription-service 用 CPU 跑 sherpa-onnx，語音辨識送到這裡的 Breeze-ASR-25，見 transcription-service ADR 0003。
