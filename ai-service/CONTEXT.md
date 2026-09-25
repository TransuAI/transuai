# AI Service

負責摘要生成、章節分段、embedding、RAG 問答（含對話記憶、streaming）。這裡只收錄這個 context
特有、容易混淆的詞彙，不是完整的功能清單——功能範圍見 `README.md`。

## Language

**對話**：
一個 job 底下所有問答共用的同一段連續脈絡，範圍就是 `job_id`，沒有獨立的
conversation/thread 概念——不能在同一個 job 底下開「第二段對話」。詳見
`docs/adr/0002-single-conversation-per-job.md`。
_Avoid_: 對話串、thread、session（這些詞暗示存在多個獨立分組，這裡沒有）

**改寫後的問題**：
使用者追問時（例如用了代名詞、省略主詞），拿去做 embedding 檢索用的獨立完整版問題，由 LLM
在檢索前產生。只影響 RAG 檢索的準確度，不會取代使用者原本輸入、存進 `qa_history`、顯示在畫面
上、或餵給 LLM 當作對話歷史的**原始問題**文字——那些永遠用使用者實際打的字。如果原始問題本身
已經完整（不依賴對話脈絡），改寫這一步會原樣照抄，不強制產生一個不同的版本。
_Avoid_: query rewriting（英文技術詞彙，這裡指的是這個 context 裡具體的行為，不是泛指這個
RAG 技術本身）

**多格式輸出**：
由 LLM 依逐字稿**生成原本不存在的新文件**（會議紀錄、Podcast 介紹、YouTube 描述、社群貼文）。
跟「匯出」是兩回事：匯出只是把既有內容轉成檔案，不產生新內容（見 `../frontend/CONTEXT.md`）。
_Avoid_: 匯出、export

**過時**：
摘要或章節生成之後，它所依據的逐字稿又被使用者**編輯**過的狀態（編輯包含改講者，定義見
`../transcription-service/CONTEXT.md`）。過時的內容照常顯示、只是被標示出來，
直到使用者手動重新產生。問答紀錄不會「過時」——它是提問當下的紀錄，不跟著逐字稿變。
_Avoid_: 失效、stale、dirty
