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
    use-post-meeting.ts     會後處理:Job 完成時載入(能不能跑、最新一份紀錄、之前的紀錄),執行與重試行動提案,開始時帶瀏覽器時區,執行中每 3 秒輪詢,結束時重新載入用量;只採用最新一次請求的回應(慢回來的舊輪詢不會蓋掉較新的狀態);放在頁面這層,手機的 Studio Sheet 關著也照樣輪詢
    use-quizzes.ts          測驗:Job 完成時載入列表,產生測驗(每次多一份),有「產生中」時每 3 秒輪詢,產生完成或失敗時重新載入用量;剛要求的測驗不會被更早送出的列表請求蓋掉;放在頁面這層,手機的 Studio Sheet 關著也照樣輪詢
    use-summary-regeneration.ts 「重新產生摘要與章節」:呼叫 regenerate,RUNNING 期間每 3 秒輪詢摘要,IDLE 換上新內容並重新載入章節、FAILED 提示並保留舊內容;進頁面時已在跑也會接著等
    use-transcript-search.ts 逐字稿搜尋狀態(query、符合結果、選中的那個、上一個 / 下一個);輸入或切換結果時暫停自動跟隨
  lib/
    api-client.ts     fetch wrapper(auth header、401 refresh-and-retry、錯誤格式)+ requestSse(手動解析 SSE frame,問答 streaming 用)
    api.ts            對應 Gateway 每支 REST API 的函式
    auth-storage.ts    token/user 存 localStorage
    current-segment.ts 依播放時間找出「目前片段」(定義見 CONTEXT.md),二分搜尋
    download.ts        把瀏覽器產生的文字存成檔案下載(Blob + object URL + <a download>);開啟伺服器給的下載 URL(跨網域 presigned 連結靠回應的 Content-Disposition 下載)
    editor-keys.ts     就地編輯器(片段文字、講者名稱)共用的按鍵:Enter 儲存、Esc 取消,輸入法組字中不處理
    export-formats.ts  匯出格式轉換(不依賴畫面):`buildExportContent` 把工作區內容組成匯出輸入,每種格式是一個 `ExportFormat`(檔名結尾、MIME、render):TXT 純文字 / 含時間戳、SRT、VTT、Markdown 報告(長度與建立時間、摘要、章節、逐字稿,可選問答紀錄——只匯出已完成的回答;摘要過時時附註);測驗另外是 `toQuizMarkdown`(輸入是整份測驗而不是工作區內容,檔名結尾與 MIME 在 `QUIZ_MARKDOWN`):題目與選項在前,最後一節是解答、解說與依據的時間戳,過時時附註;共用規則——已清空片段不匯出、兩位以上講者才標示講者、文字格式時間戳 mm:ss / h:mm:ss、檔名取原始檔名去副檔名
    navigation.ts      離開這個網站到別的網址(連結帳號時到 Google / Notion);獨立出來讓測試可以替換(jsdom 不能換頁)
    local-time.ts      <input type="datetime-local">(瀏覽器時區、沒有時差)與 API 的 ISO 8601(含時差)互轉
    media.ts           檔案型別判斷、讀取媒體長度、格式化工具(長度、檔案大小、「9/26 14:07」這種簡短時間)
    providers.ts       自有金鑰支援的廠商與顯示名稱;模型怎麼稱呼(「平台模型(…)」/「OpenAI · gpt-5」)、兩個模型是不是同一個
    usage-format.ts    用量數字的格式:token 數加千分位、轉錄秒數換成分鐘(Job 用量與本月用量共用)
    speakers.ts        講者:依標籤查顯示名稱(名稱由後端決定,逐字稿與匯出共用)、是否只有一位講者(未清空片段中出現的講者 < 2 時所有講者顯示都隱藏)、要列出的講者(還有未清空片段的)、逐字稿只在換人的第一個片段顯示講者(已清空片段不顯示也不算換人)、依顯示順序從固定配色(index.css 的 --speaker-1…8)取顏色
    staleness.ts       判斷摘要與章節、測驗是否過時(依據的逐字稿 revision < 逐字稿目前的 revision);Studio 與測驗卡片的提示、匯出的報告與測驗共用
    transcript-search.ts 逐字稿搜尋比對:只比對片段文字、英文不分大小寫、不跨片段;依片段分組
  pages/
    login-page.tsx / register-page.tsx
    upload-page.tsx        presign → PUT 上傳(含進度條)→ complete;檔案長度限制 60 分鐘(前端檢查),音訊 120MB、影片 1GB 以內(後端檢查)
    jobs-page.tsx           Job 列表、分頁、刪除
    settings-page.tsx       設定頁(側邊欄「設定」):預設模型、自有金鑰、已連結的帳號、會後處理(Notion 位置、待辦去處)、本月用量;存入或刪除金鑰後重新載入可選的模型
    settings/
      default-model-section.tsx 預設模型:平台模型與有金鑰的廠商的模型(單選),有 OpenRouter 金鑰時可輸入模型 ID;換模型不會重做既有內容
      post-meeting-settings-section.tsx 會後處理的設定:Notion 會議紀錄頁面與待辦資料庫(貼網址,儲存時後端先向 Notion 確認改過的,不行就顯示原因;顯示目前的頁面/資料庫標題)、待辦建在 Google Tasks 或 Notion(選 Notion 又沒填資料庫時提醒)
      connected-accounts-section.tsx 已連結的帳號:Google、Notion 各一列(已連結 / 已失效「請重新連結」/ 未連結);連結時向後端要授權網址再把使用者轉過去(lib/navigation.ts),回來時依網址的 ?connected= / ?connection_failed= 提示結果後清掉;中斷連結先確認,沒能通知對方撤銷時提示使用者自己去移除
      monthly-usage-section.tsx 本月用量:依模型加總,分平台模型 / 自有金鑰 / 轉錄三組(token 數與次數、轉錄分鐘數;有用量未知的呼叫會註明未計入);打開時是伺服器決定的這個月(台灣時間),可以往前看上個月、再回來;第一次載入失敗時可以重試
      provider-keys-section.tsx 自有金鑰:OpenAI / Anthropic / Google Gemini / OpenRouter 各一列,存入(後端先向廠商驗證,失敗顯示原因並保留輸入)、替換、刪除(先確認;預設模型正在用它時提示已改回平台模型);存入後只顯示末四碼
    job-detail-page.tsx     Job 狀態(WebSocket 即時更新 + 輪詢 fallback)、逐字稿(播放時高亮目前片段,聽 media element 的 timeupdate/seeked;自動跟隨的狀態也在這層;版面切換重新掛載 media element 時用 use-playback-continuity 接著播)、AI 摘要、問答(樂觀顯示 + streaming,見 job-detail/chat-pane.tsx)
    job-detail/
      export-menu.tsx          工作區頂列的「匯出」下拉選單(桌面 / 手機都有):下載各格式(報告可勾選是否包含問答紀錄)、每份已完成的測驗一項(選了才載入題目,轉成測驗 Markdown)、複製逐字稿 / 摘要(以上全部在瀏覽器產生),以及下載原始檔(向 Gateway 要 `media-url?download=true` 的附件 URL)
      completed-workspace.tsx  COMPLETED 的三欄工作區(桌面 grid / 手機 Sheet,確保同時只有一個 media element:桌面在來源欄、手機在迷你播放器;來源 Sheet 打開時聚焦 Sheet 本身而非搜尋框;標了 data-consumes-escape 的控制項(有內容的搜尋框、片段編輯器)按 Esc 做自己的事,不會關 Sheet)
      mini-player.tsx          手機版常駐底部播放列:播放 / 暫停、進度條、時間、一行目前片段文字(多位講者時前面加「名稱：」),影片顯示 16:9 小畫面
      source-pane.tsx          來源欄:檔案資訊、播放器(只有桌面 grid 那份有,由 completed-workspace 以 player slot 傳入)、講者區塊、逐字稿
      speaker-panel.tsx        講者區塊:還有片段的講者,每位一個顏色點 + 名稱;點名稱就地改名(Enter 存 / Esc 取消,名稱清空＝恢復「講者 N」,存檔失敗保留輸入);只有一位講者時不顯示
      speaker-dot.tsx          講者的顏色點(講者區塊、逐字稿換人處共用)
      chat-pane.tsx            問答欄:輸入框旁可以臨時換回答的模型(預設是預設模型,只影響這一次提問;選的是預設模型時不帶 model,由伺服器用當下的預設模型);每則回答標示「由 某模型 回答」;模型出錯時顯示廠商與原因
      usage-section.tsx        Studio 欄的「用量」區塊:這個 Job 每一次 LLM 呼叫與轉錄(時間、功能、模型、token 或分鐘數;未知顯示「—」,失敗標示),附總計;Job 完成時載入,每次問答結束、重新產生完成後重新載入
      timestamp-button.tsx     錄音裡的一個時間點,點了跳到那裡播放(問答的引用、測驗結果共用)
      quiz-dialog.tsx          作答視窗:每份測驗各自掛載(不會顯示或收到另一份的內容),載入失敗可以重試;載入整份測驗,一次一題(上一題 / 下一題,作答途中不顯示答案與解說),每題都選了才能送出;送出後由後端計分,結果頁是總分與每題的「你的答案 / 正確答案 / 解說 / 時間戳」(點時間戳跳到錄音對應的位置,沿用 seek);「重做」從第一題重來
      post-meeting-section.tsx Studio 欄的「會後處理」卡片:「開始會後處理」(不能跑時停用並顯示原因)、執行中的進度文字、失敗原因、已達上限的提示、行動提案:每種提案一份設定(表單、送出前的檢查、結果連結的文字)——行事曆活動(標題、開始、結束、描述;時間用瀏覽器的時區;必填、結束晚於開始)、email 草稿(收件人可以留空,逗號分隔,不是 email 地址會指出來;主旨、內文)、Google Tasks 待辦(標題、負責人、期限、依據的錄音時間、內容;必填標題)、Notion 頁面(標題、內容)、Notion 待辦(agent 填的每個資料庫欄位各一個輸入框,加上內文:依據的時間戳、補充說明);卡片也顯示提示(例如還沒指定 Notion 位置);還沒建立的是可以勾選、編輯的表單(跟之前已建立過的相同的標「上次已建立」、預設不勾選);「執行勾選的項目」只送出勾選的、用改過的值;已建立的附「在 Google 日曆開啟」/「在 Gmail 開啟」/「在 Google Tasks 開啟」/「在 Notion 開啟」連結;失敗的仍可以編輯,顯示原因與「重試」(沒改過就用上一次的值重試,改過就用新的值只執行這一項);「之前的會後處理(n)」展開看這個 Job 之前每一次的紀錄(時間、狀態、模型,每個提案已建立(附連結)/ 失敗(原因)/ 沒有執行)
      quiz-section.tsx         Studio 欄的「測驗」卡片:題數(5 / 10 / 20,預設 10)與「產生測驗」、測驗列表(題數、產生時間(產生中時是要求時間)、「由 某模型 產生」、最佳成績、「作答」開作答視窗、依據舊版逐字稿時提示「逐字稿已修改,這份測驗可能過時」(仍可作答);產生中顯示「產生中…」;失敗顯示原因與「再試一次」,用同樣的題數再產生一份)
      studio-pane.tsx          Studio 欄:AI 摘要(附「由 某模型 產生」)、章節、測驗、會後處理、用量;逐字稿被編輯後顯示「逐字稿已修改,摘要與章節可能過時」與「重新產生摘要與章節」按鈕(產生中顯示「重新產生中…」)
      transcript-search-bar.tsx 逐字稿搜尋列(搜尋框、n / N、上一個 / 下一個;Enter / Shift+Enter / Esc)
      segment-speaker-menu.tsx 片段的「改講者」選單(還有片段的講者 + 「新增講者…」;點片段上的講者名稱也會打開);新增講者時片段前面出現名稱輸入框(可留空＝「講者 N」)。講者分離之前的舊逐字稿新增講者後會重新讀一次逐字稿(其他片段被後端一起歸給講者 1)
      speaker-name-input.tsx   講者名稱的就地輸入框(改名、替新增的講者取名共用):Enter 存 / Esc 取消,存檔失敗保留輸入
      segment-row.tsx          單一片段:時間戳(點了 seek)、文字(搜尋高亮)、就地編輯(鉛筆 → 輸入框,Enter 存 / Esc 取消,存檔中 / 失敗保留輸入;存空字串＝清空)、已編輯片段的標記與「還原成原始文字」、已清空片段的淡色「已清空 · 還原」列、換人的第一個片段前面的講者顏色點與名稱
      transcript-view.tsx      逐字稿列表:目前片段高亮、自動跟隨(目前片段離開視野中段才平滑捲回中間,掛載當下那次直接跳到位置;使用者滾輪 / 觸控 / 捲動鍵 / 拖曳捲軸時暫停,顯示「回到播放位置」)、搜尋結果的高亮與捲動(只捲動不改播放位置)、同時只能編輯一個片段(編輯時暫停自動跟隨,也不會把正在編輯的那行捲走)、在換人的第一個片段前面顯示講者(顏色點 + 「名稱：」)
  test/
    setup.ts            Vitest 共用設定:jest-dom matcher、每則測試後 cleanup,以及 jsdom 沒實作的 ResizeObserver / matchMedia / 元素 scrollTo / URL.createObjectURL stub
  types/
    api.ts             對齊 gateway `web/dto/*.java` 的 TS 型別
```

## 已知限制

- Job 列表頁 pageSize 固定 10,沒有讓使用者調整。
- 測試集中在 Job Detail 頁面(狀態分支、Source/Studio Sheet、問答、點時間戳 seek、目前片段高亮、自動跟隨的暫停與恢復、逐字稿搜尋、手機迷你播放器與版面切換時接著播放、匯出選單、片段編輯 / 還原 / 清空、摘要與章節過時提示與重新產生、測驗卡片(產生、輪詢、失敗與再試一次、手機 Studio Sheet)與作答(途中沒有答案、結果頁、點時間戳跳轉、重做與最佳成績)、測驗的過時提示與匯出、會後處理(停用原因、開始與輪詢、提案的編輯、勾選、執行、結果與重試、上限與失敗、上次已建立、之前的紀錄)、用量區塊與重新載入、講者區塊與顏色、講者改名、改片段講者 / 新增講者(單一講者也能指定出第二位)、只有一位講者時隱藏、換人時顯示講者名稱、迷你播放器與匯出帶講者名稱)跟 sidebar / 深色模式;設定頁的預設模型、自有金鑰、已連結的帳號、會後處理設定與本月用量另有頁面測試(`settings-page.test.tsx`);匯出格式另有 `lib/export-formats.test.ts` 直接比對輸出文字;Jobs 列表只有 smoke test,Upload / Login / Register 頁面仍只靠手動跑 `npm run dev` 對照後端 API 驗證。
