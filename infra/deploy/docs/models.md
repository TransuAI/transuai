# 模型伺服器

TransuAI 不自己跑模型：摘要、問答、會後處理用的**聊天模型**、找段落用的 **embedding**、轉錄用的**語音辨識**，都呼叫另外部署的伺服器。
通常是單位自己的一台 GPU 伺服器（vLLM），也可以是任何 OpenAI 相容的服務。安裝好 TransuAI 之後，管理員在「系統設定」頁填網址、金鑰與模型，
按「檢查」確認連得上，存了馬上生效。

## 需要什麼

| 用途 | 介面 | 要求 |
| --- | --- | --- |
| 聊天模型（平台模型） | OpenAI 相容的 `/v1/chat/completions` | 會後處理要能呼叫工具（tool calling）；上下文建議 28K token 以上（一小時的逐字稿約 2.5 萬 token） |
| embedding | OpenAI 相容的 `/v1/embeddings` | 輸出 **1024 維**（資料庫的向量欄位）；換模型時系統會在背景重算所有向量 |
| 語音辨識 | OpenAI 相容的 `/v1/audio/transcriptions` | 回 `verbose_json` 的片段時間（Whisper 類模型）；講者分離在 TransuAI 裡用 CPU 做。或用 Deepgram（要連外） |

網址填到 `/v1` 為止，例如 `http://gpu01.corp.internal:8000/v1`。伺服器有設 API key 的話一起填（存起來會加密，畫面上不再顯示）。
也可以用環境變數當預設值（`.env` 的 `PLATFORM_LLM_*`、`EMBEDDING_*`、`STT_*`），設定頁存的優先。

TransuAI 只會連到設定頁（或 `.env`）填的這幾個伺服器；網路上要讓 TransuAI 這台連得到 GPU 伺服器的那幾個 port，其他機器最好連不到
（或設 API key）。模型伺服器跟 TransuAI 在同一台時填 `http://host.docker.internal:<port>/v1`。

## 參考做法：在一台 GPU 伺服器上用 vLLM 跑三個模型

下面是 2026-10 在 **RTX 5080 16 GB** 上實測的組合，一張卡放得下三個：

| | 模型 | port | 顯示記憶體比例 |
| --- | --- | --- | --- |
| 聊天 | `Qwen/Qwen3-8B-AWQ`（上下文 28,672 token，fp8 KV cache，工具呼叫用 hermes 格式） | 8000 | 0.53 |
| embedding | `Qwen/Qwen3-Embedding-0.6B`（1024 維） | 8001 | 0.12 |
| 語音辨識 | `MediaTek-Research/Breeze-ASR-25`（台灣華語、中英夾雜；fp8） | 8002 | 0.16 |

三個都起來後用了約 14.6／16.3 GB。GPU 伺服器要有 NVIDIA 驅動、Docker 與
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)。
把這個 repo 的 [`infra/scripts/vllm.sh`](../../scripts/vllm.sh) 複製到 GPU 伺服器上跑：

```bash
VLLM_API_KEY=$(openssl rand -hex 24) && echo "$VLLM_API_KEY"   # 記下來，系統設定頁要填
VLLM_API_KEY=... ./vllm.sh up      # 一個一個啟動（每個要看到自己那份顯示記憶體是空的），第一次從 Hugging Face 下載約 10GB
./vllm.sh status                   # 各自用了多少顯示記憶體、服務的模型
```

換卡或換模型用環境變數調（`VLLM_CHAT_MODEL`、`VLLM_CHAT_GPU_SHARE`、`VLLM_CHAT_MAX_LEN`、`VLLM_EMBED_*`、`VLLM_STT_*`，見腳本開頭）：

- **24 GB 以上**：`VLLM_CHAT_MAX_LEN` 可以到 40960（Qwen3-8B 的上限），或換更大的聊天模型（例如 Qwen3-14B-AWQ）。
- **12 GB 以下**：三個放不下，分到兩張卡或兩台，或聊天模型用外部的服務。

然後在 TransuAI 的「系統設定」：

| 欄位 | 填 |
| --- | --- |
| 平台模型的伺服器／模型 | `http://<GPU 伺服器>:8000/v1`／`Qwen/Qwen3-8B-AWQ`（會後處理的模型也填它） |
| embedding 的伺服器／模型 | `http://<GPU 伺服器>:8001/v1`／`Qwen/Qwen3-Embedding-0.6B`；查詢指示填 `Given a question about a recording, retrieve the transcript passages that answer it` |
| 語音辨識 | 本地：`http://<GPU 伺服器>:8002/v1`／`MediaTek-Research/Breeze-ASR-25` |
| API key | 上面的 `VLLM_API_KEY`（三個都填同一把） |

在 RTX 5080 上，一段 3 分鐘的錄音從上傳到摘要完成約 1–3 分鐘（語音辨識約 3 倍速）。

## 用外部的服務

聊天模型也可以用 Claude、OpenAI、Gemini、OpenRouter 等有 OpenAI 相容介面的服務（填它們的網址與金鑰）；這樣錄音的內容會送到那個服務，
要符合單位的規定，`/privacy` 的說明也要跟著改。語音辨識可以選 Deepgram。
