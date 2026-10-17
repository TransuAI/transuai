# ADR 0002: 媒體播放改用 presigned GET URL，取代前端直接組公開 bucket URL

## Status

Accepted

## Context

Job 詳情頁的播放器需要讀到原始媒體檔案，但 `upload.proto` 之前只有上傳用的 presigned **PUT**
URL（`GetPresignedUploadUrl`），沒有播放用的 presigned **GET** URL。暫時的解法是前端讀
`VITE_MEDIA_BASE_URL` 環境變數，直接用 `${VITE_MEDIA_BASE_URL}/${job.storagePath}` 組出 URL
（見 frontend 已知限制一節）——這只在本機開發、bucket 被設成公開讀取時才能用，正式環境的
bucket 不會公開讀取，這條路走不通，而且 `storagePath` 是內部物件儲存路徑，直接暴露給前端組
URL 也讓 bucket 的內部佈局變成前端要知道的細節。

## Decision

比照上傳流程，加一個 `GetPresignedDownloadUrl` RPC，由 upload-service 用 `S3Presigner` 對已知
的 `job.storagePath` 簽出 presigned GET URL，經 gateway 的 `GET /jobs/{jobId}/media-url` 轉發
給前端。Ownership 檢查方式跟 `GetJob` 一樣：`jobRepository.findByIdAndUserId` 找不到就回
`NOT_FOUND`，不額外驗證——理由跟 `GetJob` 相同，別人的 job 直接看起來像不存在，不用另外分辨
「存在但沒權限」跟「真的不存在」。

播放用的到期時間跟上傳用的分開設定（`STORAGE_PRESIGN_DOWNLOAD_EXPIRY_MINUTES`，預設 360
分鐘，遠長於上傳用的 `STORAGE_PRESIGN_EXPIRY_MINUTES` 預設 15 分鐘）：上傳是一次性、使用者
盯著進度條看的短暫操作，15 分鐘綽綽有餘；播放的錄音/影片可能長達 60 分鐘，使用者中途暫停、
切走分頁再回來很正常，URL 提早過期會讓播放器讀到 403。

前端拿到 `downloadUrl` 後只在 job 詳情頁掛載時抓一次（不跟著既有的 4 秒輪詢重複要），因為
`storagePath` 在 job 建立時就固定了，播放 URL 不會因為 job 狀態變化而變。移除
`VITE_MEDIA_BASE_URL` 環境變數與相關文件、程式碼。

## Consequences

**拿掉的東西**：`VITE_MEDIA_BASE_URL` 只適合本機開發、bucket 公開讀取的情境，跟正式環境的
存取模式不一致，且已被這個 RPC 完全取代，留著只會讓人誤用，直接移除。

**跟上傳流程共用的基礎設施**：`StorageService` 現在有兩個 presign 方法
（`createPresignedUploadUrl` / `createPresignedDownloadUrl`），到期時間分開設定但共用同一個
`S3Presigner`／`StorageProperties`，之後如果要加其他 presigned 操作（例如縮圖），可以沿用同一
個模式。

**沒有做的事**：沒有限制同一個 job 可以簽發幾次播放 URL，也沒有做速率限制——跟 `GetJob` 一樣，
信任 gRPC 層的身份驗證跟這個 endpoint 本身的 ownership 檢查就夠，這條路徑不會比直接呼叫
`GetJob` 更容易被濫用。

後續：同一支 rpc 之後加了 `as_attachment`，讓前端「匯出 → 下載原始檔」拿到覆寫 `Content-Disposition: attachment`（檔名＝原始檔名）的 URL；預設仍是給播放器 inline 讀取，本 ADR 的決定不變。
