# 硬體建議

## TransuAI 這台

| | 最少 | 建議 |
| --- | --- | --- |
| CPU | 4 核心 x86-64 | 8 核心 |
| 記憶體 | 8 GB（＋2–4 GB swap） | 16 GB |
| 磁碟 | 50 GB SSD | 依錄音量（見下面） |

**8 GB 的伺服器可以穩定跑**（模型在別台）。`compose.yaml` 給每個服務一個記憶體上限，Java 服務的 heap 照上限的比例、用 SerialGC；
超過上限的只有那個容器（或講者分離的子 process）被砍，不會拖垮整台。2026-10-18 用一段 59 分鐘的錄音從上傳到摘要、問答實測：

| 服務 | 上限 | 實測最高 |
| --- | --- | --- |
| transcription-service | 2.5 GB | 2.07 GB（講者分離在子 process，一小時約 1.8 GB） |
| upload-service | 640 MB | 440 MB |
| auth-service／gateway | 512 MB | 373／362 MB |
| ai-service | 640 MB | 242 MB |
| rabbitmq | 512 MB | 251 MB |
| minio | 512 MB | 175 MB |
| postgres | 512 MB | 116 MB |
| notification-service | 256 MB | 76 MB |
| redis、frontend、edge | 320／64／64 MB | 29／14／22 MB |

閒置時整套約 1.7 GB；所有服務的最高用量加起來約 4.2 GB（不會同時發生），其餘留給作業系統與檔案快取。

- **建議開 2–4 GB 的 swap**：多一層保險，記憶體偶爾不夠時變慢而不是被砍。
- **講者分離的記憶體跟錄音長度的平方成正比**（一小時約 1.8 GB）。錄音長度上限是 `.env` 的 `MAX_RECORDING_MINUTES`（預設 60）；調高的話
  `compose.yaml` 的 transcription-service 上限也要跟著調高。萬一講者分離被砍，那個檔案照樣轉錄，只是沒有分講者。
- 講者分離用 CPU（預設 4 條 thread），一小時的錄音約 7 分鐘；同時只處理一個檔案。

## 模型伺服器

模型不在這台跑，另外部署；GPU 伺服器的建議與實測的組合見 [models.md](models.md)。

## 磁碟

錄音直接存原檔：一小時的 mp3／m4a 約 30–120 MB，影片大很多（一小時 1080p 約 1–3 GB）。資料庫（逐字稿、摘要、向量）每小時錄音
約幾 MB。依每月的錄音量估，再留備份的空間（見 [backup.md](backup.md)）。單一錄音的長度上限是 `.env` 的 `MAX_RECORDING_MINUTES`。
