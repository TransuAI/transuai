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

Vitest + React Testing Library + `jsdom`。測試一律 mock `src/lib/api.ts`（或 `api-client.ts`）當作對外邊界,其餘透過使用者看得到的行為（文字、role、點擊）驅動,不測內部實作細節。設定在 `vite.config.ts` 的 `test` 欄位,共用的測試環境設定在 `src/test/setup.ts`。

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
    layout/          AppShell(頂部導覽列 + 使用者選單)
    job-status-badge.tsx
    protected-route.tsx
  context/
    auth-context.tsx  登入狀態、token 儲存、自動載入 /auth/me
  hooks/
    use-job-socket.ts  WebSocket 訂閱單一 job 狀態更新,斷線自動重連
  lib/
    api-client.ts     fetch wrapper(auth header、401 refresh-and-retry、錯誤格式)+ requestSse(手動解析 SSE frame,問答 streaming 用)
    api.ts            對應 Gateway 每支 REST API 的函式
    auth-storage.ts    token/user 存 localStorage
    current-segment.ts 依播放時間找出「目前片段」(定義見 CONTEXT.md),二分搜尋
    media.ts           檔案型別判斷、讀取媒體長度、格式化工具
  pages/
    login-page.tsx / register-page.tsx
    upload-page.tsx        presign → PUT 上傳(含進度條)→ complete
    jobs-page.tsx           Job 列表、分頁、刪除
    job-detail-page.tsx     Job 狀態(WebSocket 即時更新 + 輪詢 fallback)、逐字稿(播放時高亮目前片段,聽 media element 的 timeupdate/seeked)、AI 摘要、問答(樂觀顯示 + streaming,見 job-detail/chat-pane.tsx)
  test/
    setup.ts            Vitest 共用設定(目前只掛 @testing-library/jest-dom 的 matcher)
  types/
    api.ts             對齊 gateway `web/dto/*.java` 的 TS 型別
```

## 已知限制

- Job 列表頁 pageSize 固定 10,沒有讓使用者調整。
- 測試集中在 Job Detail 頁面(狀態分支、Source/Studio Sheet、問答、點時間戳 seek、目前片段高亮)跟 sidebar / 深色模式;Jobs 列表只有 smoke test,Upload / Login / Register 頁面仍只靠手動跑 `npm run dev` 對照後端 API 驗證。
