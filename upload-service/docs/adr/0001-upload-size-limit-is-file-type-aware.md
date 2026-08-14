# ADR 0001: 上傳檔案大小限制依檔案類型而定，不是單一固定上限

## Status

Accepted

## Context

MVP 階段的 30 分鐘時長限制（`frontend/src/pages/upload-page.tsx` 的 `MAX_DURATION_SECONDS`）是目前唯一的上傳限制，而且只在前端強制——後端完全不驗證，`GetPresignedUploadUrlRequest`/`CompleteUploadRequest` 帶的 `file_size_bytes` 也只檢查是否為正數，沒有上限，繞過前端（curl、改過的前端）就能上傳任意大小/長度的檔案。

`architecture-design.md` §8 留了一個開放問題：要不要把 30 分鐘的時長限制換成檔案大小限制（例如對齊 Groq Whisper 免費層的 25MB 檔案大小上限）。表面上看，檔案大小比時長更貼近 Groq 實際會擋下的東西，而且 `file_size_bytes` 在 presign 階段就已經送到後端，看似可以直接拿來做便宜的早期擋檢查。

但 `file_size_bytes` 在 presign 階段代表的是**使用者上傳的原始檔案大小**，而 Groq 25MB 上限限制的是**最終送進 Whisper API 的音軌大小**。這兩者對 AUDIO 上傳是同一件事（原始檔案本身就是音訊），但對 VIDEO 上傳完全不是——一個 30 分鐘、容器/畫面編碼開銷很大的影片檔案可能有幾百 MB 到 GB，但抽出來的音軌可能遠低於 25MB。反過來說，時長（不分檔案容器/編碼格式）才是不管 AUDIO 或 VIDEO 都能合理預測「最終要餵給 Groq 多少音訊內容」的指標。

## Decision

不用單一固定的大小上限取代時長限制，而是兩種限制分開、各自對應它們真正在防的東西：

1. **時長限制（30 分鐘，前端強制）**：維持現狀，作為 VIDEO 上傳唯一有意義的 Groq 相關把關——這是獨立的 MVP 產品決策（保持 job 短小、快速迭代），不是從 Groq 上限推導出來的技術代理值，所以即使之後 Groq 的限制改變，這個值也不必跟著變。
2. **AUDIO 專用大小上限（`app.upload.max-audio-file-size-bytes`，預設 20MB）**：只套用在 `file_type == AUDIO` 的上傳，因為只有這種情況下 `file_size_bytes` 才等於最終送進 Groq 的音軌大小。20MB（而非 Groq 官方講的 25MB）留一點安全邊界。
3. **不分類型的濫用防護上限（`app.upload.max-file-size-bytes`，預設 1GB）**：套用在所有上傳（含 VIDEO），純粹是擋濫用/控制儲存成本，跟 Groq 的限制無關——不會因為 Groq 政策改變而需要跟著調整。

兩項後端限制都在 `GetPresignedUploadUrl`（用呼叫端回報的 `file_size_bytes` 做早期、便宜的擋檢查）跟 `CompleteUpload`（改問物件儲存實際存了多大，因為 `file_size_bytes` 是呼叫端可以隨便亂填的數字，不能拿來做真正的把關）各檢查一次；`CompleteUpload` 這關如果沒過，物件會被立即刪除（沿用 `deleteJob()` 既有的「刪除失敗只記警告、不擋主要流程」模式），不會留下孤兒物件。

## Consequences

**接受的取捨**：VIDEO 上傳沒有跟 Groq 直接掛鉤的大小把關——一個音軌恰好超過 20MB 的 VIDEO 檔案（例如講者密度極高、選了不利壓縮的音訊編碼）還是有可能在 transcription-service 呼叫 Groq 時才真正失敗。這個失敗會被 `transcription-service/app/services/retry.py` 分類成永久性失敗（Groq 回 413/400 類錯誤，不重試），直接判定 job FAILED——跟現狀行為一致，只是沒有更早擋下來。真的要更早擋，需要在 transcription-service 抽完音軌後、呼叫 Groq 前做一次音軌大小檢查，這是後續可以做的加強，不影響這裡的決定。

**已知限制（刻意接受，不是漏洞）**：`file_type` 本身是呼叫端在 `GetPresignedUploadUrl`／`CompleteUpload` 兩次請求裡各自回報的欄位，upload-service 不會（也沒辦法，沒有內容嗅探/ffprobe）驗證實際上傳的位元組內容是否真的是該類型。呼叫端只要在兩次請求裡都一致宣告 `file_type=VIDEO`，就算實際上傳的是音訊內容，也只會套用比較寬鬆的濫用防護上限（1GB），不會套用 AUDIO 專用的 Groq 上限（20MB）。這不是本 ADR 新產生的洞——這個系統目前任何一處都沒有做內容型別驗證（transcription-service 一樣完全信任 Job 記錄的 `file_type` 來決定要不要跑 ffmpeg 抽音軌），加上濫用防護上限依然生效、被誤標的內容一樣會在 Groq 呼叫時走到既有的 FAILED 路徑，所以判斷這是可以接受的既有限制，不是這次要解決的問題。

**遺留的地基**：`UploadLimitsProperties` 是這個服務第一次用 `@ConfigurationPropertiesScan` 之外額外命名一組上傳限制設定，之後如果要加其他跟上傳相關的限制（例如檔名長度、允許的副檔名），可以沿用同一個 record；`applicableMaxFileSizeBytes(FileType)` 是「哪個檔案類型套用哪個上限」這個政策唯一的實作位置，`GetPresignedUploadUrl` 跟 `CompleteUpload` 都呼叫它，不會各自維護一份、將來政策改動時漏改一邊。
