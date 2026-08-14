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
| API 呼叫 | 手刻的 `fetch` wrapper（`src/lib/api-client.ts`），處理 401 → 自動 refresh token → 重試一次 |
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
| `VITE_MEDIA_BASE_URL` | 未設定 | 選填。Job 詳情頁的音訊/影片播放器（含逐字稿時間戳跳轉)需要能讀到原始檔案,但目前 Gateway/Upload Service 還沒有「取得播放/下載 URL」的 API(見已知限制),沒設這個變數的話詳情頁就不會顯示播放器,只顯示逐字稿文字 |

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
    api-client.ts     fetch wrapper(auth header、401 refresh-and-retry、錯誤格式)
    api.ts            對應 Gateway 每支 REST API 的函式
    auth-storage.ts    token/user 存 localStorage
    media.ts           檔案型別判斷、讀取媒體長度、格式化工具
  pages/
    login-page.tsx / register-page.tsx
    upload-page.tsx        presign → PUT 上傳(含進度條)→ complete
    jobs-page.tsx           Job 列表、分頁、刪除
    job-detail-page.tsx     Job 狀態(WebSocket 即時更新 + 輪詢 fallback)、逐字稿、AI 摘要
  test/
    setup.ts            Vitest 共用設定(目前只掛 @testing-library/jest-dom 的 matcher)
  types/
    api.ts             對齊 gateway `web/dto/*.java` 的 TS 型別
```

## 已知限制

- **沒有播放/下載媒體檔案的 API**:`JobDto.storagePath` 只是內部物件儲存路徑,Gateway/Upload Service 目前沒有開「取得可播放 URL」的端點(對照 `upload.proto`,只有上傳用的 presigned **PUT** URL,沒有播放用的 presigned **GET** URL)。詳情頁的時間戳目前只是純文字顯示,設定 `VITE_MEDIA_BASE_URL` 才會嘗試直接組 URL 播放(僅適合本機開發、bucket 設為公開讀取的情境),正式功能要等後端補上對應 API。
- Job 列表頁 pageSize 固定 10,沒有讓使用者調整。
- 測試覆蓋率目前很低（只有 `jobs-page.test.tsx` 一個 smoke test,證明測試基礎建設本身可用),大部分頁面仍只靠手動跑 `npm run dev` 對照後端 API 驗證。
