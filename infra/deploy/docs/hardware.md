# 硬體建議

## 不跑本地模型（模型與語音辨識用外部的伺服器）

| | 最少 | 建議 |
| --- | --- | --- |
| CPU | 4 核心 x86-64 | 8 核心 |
| 記憶體 | 8 GB | 16 GB |
| 磁碟 | 50 GB SSD | 依錄音量（見下面） |

2026-10-18 實測整套服務閒置時用約 3 GB 記憶體（三個 Java 服務各 0.6–0.9 GB）。講者分離在 transcription-service 裡用 CPU 跑
（pyannote segmentation＋CAM++），處理時多用約 1 GB 與數個核心；同時只處理一個檔案。

## 一起跑本地模型（`--profile gpu`）

| | 建議 |
| --- | --- |
| GPU | NVIDIA，16 GB 以上顯示記憶體，vLLM 支援的架構（Turing 以後；RTX 50 系列要 vLLM v0.31 以上） |
| 記憶體 | 32 GB |
| 磁碟 | 再加 30 GB（vLLM image 與模型權重） |
| 軟體 | NVIDIA 驅動、[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) |

預設的三個模型（`.env` 的 `VLLM_*`）是在 **RTX 5080 16 GB** 上實測調好的：

| 服務 | 模型 | 顯示記憶體比例 |
| --- | --- | --- |
| vllm-chat | Qwen/Qwen3-8B-AWQ（上下文 28,672 token，fp8 KV cache） | 0.53 |
| vllm-embed | Qwen/Qwen3-Embedding-0.6B（1024 維） | 0.12 |
| vllm-stt | MediaTek-Research/Breeze-ASR-25（台灣華語、中英夾雜；fp8） | 0.16 |

三個都起來後用了約 14.6／16.3 GB，處理時最高約 15.7 GB。比例是整張卡的比例，加起來要留空間給驅動（與桌面，如果有的話）。
一段 3 分鐘的錄音從上傳到摘要完成約 1–3 分鐘（語音辨識約 3 倍速，講者分離在 CPU）。

換別張卡：

- **24 GB 以上**：可以把 `VLLM_CHAT_MAX_LEN` 提高到 40960（Qwen3-8B 的上限），或換更大的聊天模型（例如 Qwen3-14B-AWQ），
  `VLLM_CHAT_GPU_SHARE` 跟著調。換模型後系統設定頁的平台模型名稱也要改。
- **12 GB 以下**：三個放不下。只在本機跑 embedding 與語音辨識，聊天模型用外部的伺服器（系統設定頁）；或全部用外部的。
- embedding 模型一定要輸出 1024 維（資料庫的向量欄位）；換了 embedding 模型，系統會在背景重算所有向量。

## 磁碟

錄音直接存原檔：一小時的 mp3／m4a 約 30–120 MB，影片大很多（一小時 1080p 約 1–3 GB）。資料庫（逐字稿、摘要、向量）每小時錄音
約幾 MB。依每月的錄音量估，再留備份的空間（見 [backup.md](backup.md)）。單一錄音的長度上限是 `.env` 的 `MAX_RECORDING_MINUTES`。
