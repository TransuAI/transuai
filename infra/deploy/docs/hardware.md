# 硬體建議

## TransuAI 這台

| | 最少 | 建議 |
| --- | --- | --- |
| CPU | 4 核心 x86-64 | 8 核心 |
| 記憶體 | 8 GB | 16 GB |
| 磁碟 | 50 GB SSD | 依錄音量（見下面） |

2026-10-18 實測整套服務閒置時用約 3 GB 記憶體（三個 Java 服務各 0.6–0.9 GB）。講者分離在 transcription-service 裡用 CPU 跑
（pyannote segmentation＋CAM++），處理時多用約 1 GB 與數個核心；同時只處理一個檔案。

## 模型伺服器

模型不在這台跑，另外部署；GPU 伺服器的建議與實測的組合見 [models.md](models.md)。

## 磁碟

錄音直接存原檔：一小時的 mp3／m4a 約 30–120 MB，影片大很多（一小時 1080p 約 1–3 GB）。資料庫（逐字稿、摘要、向量）每小時錄音
約幾 MB。依每月的錄音量估，再留備份的空間（見 [backup.md](backup.md)）。單一錄音的長度上限是 `.env` 的 `MAX_RECORDING_MINUTES`。
