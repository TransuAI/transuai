# TransuAI

上傳會議、課程的錄音或影片，產生有講者的逐字稿、摘要、章節、決策與待辦，並且可以針對內容問答。為了裝在單位內部的伺服器上而設計：
語音辨識、講者分離、摘要與問答的模型都可以在本機跑（vLLM），完全不用連外；也可以接 Claude、OpenAI、Gemini、OpenRouter 或其他
OpenAI 相容的服務。

## 安裝

一台有 Docker 的 Linux 伺服器（有 NVIDIA GPU 的話可以一起跑本地模型）：

```bash
git clone <這個 repo> transuai
cd transuai/infra/deploy
./install.sh
```

打開印出來的網址，第一個註冊的帳號就是管理員，在「系統設定」填模型、語音辨識與寄信。詳細的步驟、硬體建議、備份、升級、憑證與
離線安裝見 [infra/deploy/README.md](infra/deploy/README.md)。

## 開發

| 目錄 | 內容 |
| --- | --- |
| [frontend](frontend/) | 網頁（React、Vite） |
| [gateway](gateway/) | 對外的 REST API（Spring Boot） |
| [auth-service](auth-service/) | 帳號、登入、管理員、寄信 |
| [upload-service](upload-service/) | 上傳、檔案列表 |
| [transcription-service](transcription-service/) | 語音辨識、講者分離、逐字稿 |
| [ai-service](ai-service/) | 摘要、章節、問答、會後處理 |
| [notification-service](notification-service/) | 處理進度的 WebSocket |
| [infra](infra/) | proto、本機開發環境（docker-compose、kind）、安裝包 |

本機開發環境見 [infra/README.md](infra/README.md)；架構見 [infra/architecture-design.md](infra/architecture-design.md)。

## 授權

TransuAI 以 [Apache License 2.0](LICENSE) 授權。

安裝包另外用到的元件各有自己的授權（都是原樣使用，沒有修改）：MinIO（`pgsty/minio`，AGPL-3.0，獨立的容器）、PostgreSQL＋pgvector、
Redis、RabbitMQ、nginx、vLLM（Apache-2.0）；預設的模型 Qwen3-8B-AWQ、Qwen3-Embedding-0.6B、Breeze-ASR-25（Apache-2.0），
講者分離的 pyannote segmentation-3.0（MIT）與 3D-Speaker CAM++（Apache-2.0）。
