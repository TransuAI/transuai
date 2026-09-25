# frontend

音訊/影片逐字稿 + AI 分析平台的前端。React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui。

對照 [`../infra/architecture-design.md`](../infra/architecture-design.md),對接 Gateway 的 REST API（`../gateway`)與 notification-service 的 WebSocket。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | React 19 + Vite（`react-ts` 模板） |
| UI | Tailwind CSS v4 + shadcn/ui（Nova preset：Radix + Geist 字型） |
| 路由 | react-router-dom v7 |
| 狀態 | 沒有拉 Redux/Zustand,登入狀態用一個簡單的 `AuthContext`（`src/context/auth-context.tsx`），Job 資料用各頁面自己的 `useState`/`useEffect`,規模還不需要全域 data-fetching 套件 |
| API 呼叫 | 手刻的 `fetch` wrapper（`src/lib/api-client.ts`），處理 401 → 自動 refresh token → 重試一次；問答走 SSE（`requestSse`），不用原生 `EventSource`——它沒辦法附加 Authorization header，見 [`../docs/adr/0001-sse-via-gateway-for-streaming-qa.md`](../docs/adr/0001-sse-via-gateway-for-streaming-qa.md) |
| 即時更新 | 原生 `WebSocket`（`src/hooks/use-job-socket.ts`）直連 notification-service |

## 前置需求

需要先啟動後端(至少 Gateway + Auth + Upload,完整功能需要六個服務都起來,見 [`../infra/README.md`](../infra/README.md))：

```bash
cd ../infra
docker compose up -d
```

再依序啟動 `auth-service` / `upload-service` / `transcription-service` / `ai-service` / `notification-service` / `gateway`（各自 README 有說明）。

## 開發

```bash
cp .env.example .env   # 第一次使用才需要,預設值就能跑
npm install
npm run dev
```

### 測試

```bash
npm test
```

Vitest + React Testing Library + `jsdom`。頁面測試一律 mock `src/lib/api.ts`（或 `api-client.ts`）當作對外邊界,其餘透過使用者看得到的行為（文字、role、點擊）驅動,不測內部實作細節。不碰畫面也沒有 I/O 的純函式模組(例如 `lib/export-formats.ts`,規則組合多、直接比對輸出文字比透過頁面可靠)則直接測它的 export。設定在 `vite.config.ts` 的 `test` 欄位,共用的測試環境設定在 `src/test/setup.ts`。

`vite.config.ts` 把 `/api` proxy 到 `http://localhost:8080`（Gateway),所以本機開發預設 `VITE_API_BASE_URL=/api` 即可,不會有 CORS 問題。notification-service 的 WebSocket(`8085`)沒有走 Gateway,前端直連,見 `.env.example` 的 `VITE_WS_BASE_URL`。

### 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Gateway REST base URL,dev 模式靠 vite proxy 轉發到 `localhost:8080` |
| `VITE_WS_BASE_URL` | `ws://localhost:8085` | notification-service WebSocket base URL |

## 專案結構

```
src/
  components/
    ui/              shadcn/ui 元件(不手動改,要改用 npx shadcn add --overwrite)
    layout/          AppShell、Sidebar(導覽、使用者選單;Job Detail 頁自動收成 icon rail)、深色模式切換
    job-status-badge.tsx
    protected-route.tsx
  context/
    auth-context.tsx  登入狀態、token 儲存、自動載入 /auth/me
  hooks/
    use-auto-follow.ts 自動跟隨的兩態狀態(跟隨中 / 已暫停)與 pause / resume
    use-job-socket.ts  WebSocket 訂閱單一 job 狀態更新,斷線自動重連
    use-media-playback.ts 把 media element 的播放狀態(時間、長度、是否暫停)同步成 React state;每次 timeupdate 都會 re-render,只給迷你播放器這種小元件用
    use-media-query.ts matchMedia 的 hook(工作區用它判斷桌面 / 手機版面)
    use-playback-continuity.ts 版面切換重新掛載 media element 時,把播放位置跟「是否正在播放」帶到新元素
    use-transcript-search.ts 逐字稿搜尋狀態(query、符合結果、選中的那個、上一個 / 下一個);輸入或切換結果時暫停自動跟隨
  lib/
    api-client.ts     fetch wrapper(auth header、401 refresh-and-retry、錯誤格式)+ requestSse(手動解析 SSE frame,問答 streaming 用)
    api.ts            對應 Gateway 每支 REST API 的函式
    auth-storage.ts    token/user 存 localStorage
    current-segment.ts 依播放時間找出「目前片段」(定義見 CONTEXT.md),二分搜尋
    download.ts        把瀏覽器產生的文字存成檔案下載(Blob + object URL + <a download>)
    export-formats.ts  匯出格式轉換(不依賴畫面):`buildExportContent` 把工作區內容組成匯出輸入,每種格式是一個 `ExportFormat`(檔名結尾、MIME、render):TXT 純文字 / 含時間戳、SRT、VTT、Markdown 報告(長度與建立時間、摘要、章節、逐字稿,可選問答紀錄——只匯出已完成的回答;摘要過時時附註);共用規則——已清空片段不匯出、兩位以上講者才標示講者、文字格式時間戳 mm:ss / h:mm:ss、檔名取原始檔名去副檔名
    media.ts           檔案型別判斷、讀取媒體長度、格式化工具
    transcript-search.ts 逐字稿搜尋比對:只比對片段文字、英文不分大小寫、不跨片段;依片段分組
  pages/
    login-page.tsx / register-page.tsx
    upload-page.tsx        presign → PUT 上傳(含進度條)→ complete
    jobs-page.tsx           Job 列表、分頁、刪除
    job-detail-page.tsx     Job 狀態(WebSocket 即時更新 + 輪詢 fallback)、逐字稿(播放時高亮目前片段,聽 media element 的 timeupdate/seeked;自動跟隨的狀態也在這層;版面切換重新掛載 media element 時用 use-playback-continuity 接著播)、AI 摘要、問答(樂觀顯示 + streaming,見 job-detail/chat-pane.tsx)
    job-detail/
      export-menu.tsx          工作區頂列的「匯出」下拉選單(桌面 / 手機都有):下載各格式(報告可勾選是否包含問答紀錄)、複製逐字稿 / 摘要,全部在瀏覽器產生
      completed-workspace.tsx  COMPLETED 的三欄工作區(桌面 grid / 手機 Sheet,確保同時只有一個 media element:桌面在來源欄、手機在迷你播放器;來源 Sheet 打開時聚焦 Sheet 本身而非搜尋框,Esc 先清空搜尋再關 Sheet)
      mini-player.tsx          手機版常駐底部播放列:播放 / 暫停、進度條、時間、一行目前片段文字,影片顯示 16:9 小畫面
      source-pane.tsx          來源欄:檔案資訊、播放器(只有桌面 grid 那份有,由 completed-workspace 以 player slot 傳入)、逐字稿
      chat-pane.tsx            問答欄
      studio-pane.tsx          Studio 欄:AI 摘要、章節
      transcript-search-bar.tsx 逐字稿搜尋列(搜尋框、n / N、上一個 / 下一個;Enter / Shift+Enter / Esc)
      transcript-view.tsx      逐字稿列表:目前片段高亮、自動跟隨(目前片段離開視野中段才平滑捲回中間,掛載當下那次直接跳到位置;使用者滾輪 / 觸控 / 捲動鍵 / 拖曳捲軸時暫停,顯示「回到播放位置」)、搜尋結果的高亮與捲動(只捲動不改播放位置)
  test/
    setup.ts            Vitest 共用設定:jest-dom matcher、每則測試後 cleanup,以及 jsdom 沒實作的 ResizeObserver / matchMedia / 元素 scrollTo / URL.createObjectURL stub
  types/
    api.ts             對齊 gateway `web/dto/*.java` 的 TS 型別
```

## 已知限制

- Job 列表頁 pageSize 固定 10,沒有讓使用者調整。
- 測試集中在 Job Detail 頁面(狀態分支、Source/Studio Sheet、問答、點時間戳 seek、目前片段高亮、自動跟隨的暫停與恢復、逐字稿搜尋、手機迷你播放器與版面切換時接著播放、匯出選單)跟 sidebar / 深色模式;匯出格式另有 `lib/export-formats.test.ts` 直接比對輸出文字;Jobs 列表只有 smoke test,Upload / Login / Register 頁面仍只靠手動跑 `npm run dev` 對照後端 API 驗證。
