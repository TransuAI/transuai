# ADR 0009: Notion 裡一場會議一個子頁面，會議紀錄和待辦放在一起

## Status

Accepted（2026-09-28）。取代 `post-meeting-processing` ticket 06 的「待辦資料庫」設計。

## Context

ticket 06 讓使用者在 Notion 指定兩個地方：會議紀錄頁面（會議紀錄建在它底下）和待辦資料庫（每個待辦新增一筆）。第一次用真的
Notion 走完之後：

- 使用者心裡的樣子是「一場會議就是 Notion 裡的一頁」，會議紀錄跟這場會議的待辦在同一頁，不是分兩個地方。
- 待辦資料庫要使用者先建好欄位對的資料庫，而且 Notion MCP 對欄位值有特殊格式（日期要寫成 `date:欄位:start`、勾選是
  `__YES__`、人員要填使用者 ID），模型不知道就會被拒絕。
- 實際新增待辦時，Notion 拒絕了：送出的 data source ID 帶著 `collection://` 前綴，Notion MCP 的 `notion-create-pages` 要的是
  不帶前綴的 ID，`parent` 也要帶 `type`。這是 ticket 06 記下「還沒用真的 Notion 走過」的那一段。
- 設定頁寫「要先在 Notion 分享給 TransuAI」是錯的：Notion 官方 MCP 用使用者自己的權限（「read and update content that you
  can access」），不用另外分享。

## Decision

- **設定只有一個 Notion 位置**：會議紀錄要放在哪個頁面底下。拿掉待辦資料庫（設定、proto 欄位、資料表欄位）。
- **一場會議一個提案**：`notion_create_meeting_page` 在那個頁面底下建一個子頁面，參數是標題、會議紀錄（Markdown）和
  `todos`（每條：內容必填，負責人、期限 YYYY-MM-DD、依據的錄音時間選填）。提案畫面可以一條條修改、刪除、新增待辦。
- **待辦去處**（值不變）：
  - `notion`：待辦寫成子頁面裡的打勾清單（`- [ ]`），每條附負責人、期限、依據的錄音時間。
  - `google_tasks`（預設）：待辦照舊每條一個 Google Tasks 提案；子頁面裡的待辦是一般清單，方便閱讀，不會兩邊都要打勾。
- `notion-create-pages` 的 `parent` 照 Notion MCP 的格式：`{"type": "page_id", "page_id": …}`。
- 設定頁儲存時用 `notion-fetch` 回應裡的 `metadata.type` 判斷是不是頁面（頁面裡嵌了表格照樣是頁面）。
- 建立好的網址也認 `app.notion.com`（Notion 現在的網址）；之前只認 `notion.so`，建立成功也拿不到連結。
- 已經存下的舊提案（`notion_create_todo`／`notion_database_item`）執行時寫明「這種提案已經不再提供，請重新跑一次會後處理」。

## Consequences

- 待辦不再進使用者自己的 Notion 資料庫，不能用 Notion 的資料庫檢視（依負責人、期限篩選）管理待辦；要那樣用的人，待辦放
  Google Tasks，或之後再做「寫進既有資料庫」。
- Notion 裡的打勾清單是一般的 to-do 區塊，完成狀態不會同步回 TransuAI。
- 「上次已建立」對 Notion 的判斷照舊看子頁面的標題；子頁面裡的單條待辦不各自比對。
