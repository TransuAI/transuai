# ADR 0002: 音訊/影片播放用 upload-service 簽發的 presigned GET URL，不由 Gateway 代理串流

## Status

Accepted

## Context

前端 Job 詳情頁（`source-pane.tsx`、`job-detail-page.tsx`、`chat-pane.tsx`）已經把播放器跟「點擊逐字稿/問答來源時間戳跳轉播放」的 UI 全部做完了，`<video>`/`<audio>` 元素、`onSeek`、`mediaRef.currentTime` 都已串好——缺的只是媒體檔案的可播放 URL。目前的做法是前端用 `VITE_MEDIA_BASE_URL` 環境變數直接跟 `Job.storagePath`（純物件儲存 key）字串相接（`job-detail-page.tsx` 的 `mediaUrl`），這只有在 bucket 設成公開讀取時才會動，`frontend/README.md` 已把它記成已知限制，正式環境不能這樣做。

`upload-service` 已經有一套上傳用的 presigned **PUT** URL機制（`StorageService.createPresignedUploadUrl`，用 AWS SDK v2 的 `S3Presigner`，`GetPresignedUploadUrl` gRPC RPC，TTL 由 `STORAGE_PRESIGN_EXPIRY_MINUTES` 控制，預設 15 分鐘），但沒有對應的下載/播放用 **GET** presign。

有三個可行做法：

1. **presigned GET URL（本 ADR 採用）**：`upload-service` 比照現有 PUT 的做法，用 `S3Presigner.presignGetObject` 簽出一個限時可讀的直連 URL，Gateway 開一個新 REST endpoint 把它轉發給前端，前端直接把這個 URL 塞進 `<video src>`/`<audio src>`。
2. **Gateway 代理串流**：Gateway 自己向物件儲存拉取 bytes 再轉發給前端，媒體檔案的每個 byte 都流經 Gateway。
3. **維持現狀**：繼續靠 bucket 公開讀取 + 環境變數，不做後端 API。

## Decision

採用選項 1：`upload-service` 新增 `StorageService.createPresignedDownloadUrl`，新增 gRPC RPC `GetPresignedDownloadUrl`；Gateway 新增 `GET /jobs/{jobId}/media-url`，比照現有「一個 REST endpoint 對應一個 gRPC RPC」的慣例（沒有把這個 URL 塞進既有 `GET /jobs/{jobId}` 的 `JobDto` 裡，因為那個 endpoint 在 job 處理中會被前端每 4 秒輪詢一次，沒必要每次都多簽一個 URL），ownership 檢查沿用 `getJob` 現有模式（`upload-service` 內部用 `findByIdAndUserId` 過濾，找不到就回 `NOT_FOUND`，Gateway 不用重複驗證一次）。

播放用的 TTL 跟上傳用的分開設定，新增 `STORAGE_PRESIGN_DOWNLOAD_EXPIRY_MINUTES`，預設 360 分鐘（6 小時）：上傳是一次性的短暫操作，15 分鐘綽綽有餘；播放的情境是使用者可能中途暫停、離開分頁再回來繼續聽/看完一份可能長達 30 分鐘的會議或講座錄音，如果沿用 15 分鐘，暫停稍久重新播放就會直接 404。

前端這次一併移除 `VITE_MEDIA_BASE_URL` 跟原本的字串拼接邏輯，改成一律呼叫新的 `media-url` endpoint 取得播放用 URL，不保留舊邏輯當 fallback。

## Consequences

**為什麼不選 Gateway 代理串流**：媒體檔案的 bytes 完全不需要經過 Gateway 這層 JVM 進程，直連物件儲存讓 seek（`onSeek` 跳時間戳）用的 HTTP Range request 直接由 S3/MinIO 原生處理，不用在 Spring 這邊手刻 Range 支援；Gateway 也不會因為使用者同時播放多支影片而承受額外的頻寬/記憶體壓力。代價是播放 URL 本身（即使簽過期）會直接指向物件儲存位置，但這跟現有 PUT presign 的曝險模型一致，不是這次新引入的風險。

**已知限制（刻意接受）**：presigned URL 一旦簽出，在到期（6 小時）前無法即時撤銷——如果使用者權限在這 6 小時內被收回，或 job 被刪除，先前拿到的 URL 仍然可以用到過期為止。6 小時窗口夠短，判斷這個曝險可以接受，跟現有上傳 TTL 的設計邏輯一致，沒有另外做撤銷機制。

**遺留的地基**：`StorageService` 現在同時有 `createPresignedUploadUrl`（PUT）跟 `createPresignedDownloadUrl`（GET）兩個方法，兩者共用同一個 `S3Presigner` 實例，只是 request 類型跟 TTL 設定不同；之後如果要加其他類型的 presigned 操作（例如刪除確認連結），可以沿用同一個類別。
