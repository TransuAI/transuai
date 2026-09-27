# ADR 0002: 轉錄語言由上傳時選擇（中文、英文、自動偵測）

## Status

Accepted（2026-09-28）。局部取代 ADR 0001 的「語言固定指定 `zh-TW`，不自動偵測」；ADR 0001 的其他決定不變。

## Context

ADR 0001 把送給 Deepgram 的語言固定成 `zh-TW`，並記下「非中文錄音會辨識得很差」是接受的退步。實際上傳一段 24 分鐘的英文會議後，
Deepgram 被要求用中文聽，只拼出一些破碎的片段（「hi t is is e r ic john son…」），聽不出來的整段丟掉，整份逐字稿只剩三行。

ADR 0001 的實測也說明了為什麼不能直接改成自動偵測：`detect_language` 偵測到中文時只給 `zh`，走的是通用中文模型，輸出簡體、
錯字明顯變多——對以台灣中文為主的使用者是退步。

## Decision

- **上傳時選轉錄語言**，一路帶到語音辨識：前端上傳頁 → Gateway `POST /uploads/complete` 的 `transcriptionLanguage` →
  upload-service 的 `CompleteUpload`（存在 `jobs.transcription_language`）→ `transcription.requested` 訊息的
  `transcriptionLanguage` → transcription-service 的 `recognize()`。
- 三個值：
  - `zh-TW`（中文，**預設**）：跟以前一樣指定 `language=zh-TW`，中文準確度不變。
  - `en`（英文）：指定 `language=en`。
  - `auto`（自動偵測）：不指定語言，改送 `detect_language=zh&detect_language=en`（Deepgram 限定候選語言的寫法），整個檔案
    判斷成其中一種。逐字稿的語言存 Deepgram 回的 `detected_language`；偵測到中文照舊用 OpenCC 轉繁體。
- 沒帶語言（舊的前端、升級當下還在佇列裡的舊訊息、這個欄位之前建立的 Job）一律當成中文，用設定 `DEEPGRAM_LANGUAGE` 的值。
- upload-service 只接受這三個值，其他回 `INVALID_ARGUMENT`。

## Consequences

- 使用者要自己選對語言；選錯（例如英文會議選了中文）照樣會轉壞。預設是中文，上傳頁把選項放在上傳按鈕旁邊。
- 選「自動偵測」而判斷成中文時，錯字會比選「中文」多（ADR 0001 的實測），上傳頁在這個選項下方寫明。
- 一段錄音裡中英夾雜（每句切換）仍然辨識不好：Deepgram 一個檔案只判斷一種語言。
- 既有的 Job 沒有「重新轉錄」，語言選錯要重新上傳。
- 摘要、章節、會後處理不跟著語言切換：英文會議的摘要用什麼語言寫，由模型依提示決定。
