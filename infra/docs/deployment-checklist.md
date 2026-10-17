# 客戶內部部署的清單

TransuAI 由客戶部署在自己的環境（2026-10-17 決定）。這份清單是程式碼**做不到、要在部署環境做**的事，來自上線前驗證
（`.scratch/pre-launch-hardening/asvs-l1.md` 標「部署時要做」的項目，與 `issues/01`、`09`、`11` 留下的事項）。上線前逐項打勾。

## 1. 密鑰與正式環境的設定

- [ ] 每個服務設 `APP_ENV=production`：啟動時檢查自己的密鑰（沒設、是開發用的預設值、或太短就不啟動，並說出是哪個環境變數），
      並關掉 Swagger／API 文件與 gRPC reflection。
- [ ] 換掉 `infra/k8s/02-secret.yaml` 的每一個值：`DB_PASSWORD`／`POSTGRES_PASSWORD`、`RABBITMQ_PASSWORD`、`STORAGE_SECRET_KEY`／`MINIO_ROOT_PASSWORD`
      （至少 12 字元），`JWT_SECRET`（至少 32 字元，隨機產生，auth-service、gateway、notification-service 用同一把），`REDIS_PASSWORD`，
      `KEY_ENCRYPTION_KEY`（自有金鑰與 OAuth 權杖的主金鑰，**遺失就解不開已存的金鑰**，要另外備份），外部服務的金鑰（`DEEPGRAM_API_KEY`、
      `HF_API_KEY`、`TAVILY_API_KEY`、`GOOGLE_OAUTH_*`）。
- [ ] secret 建好之後用 `kubectl patch` 一個一個改，**不要重新 `kubectl apply` 整份 `02-secret.yaml`**（會把改過的值蓋回空字串）。
- [ ] 密鑰不進版控、不放進 image；用客戶環境的 secret 管理（Kubernetes Secret、Vault 等）。

## 2. 網址、TLS 與反向代理

前端、API、WebSocket 放在**同一個網站**（同一個網域）：refresh token 的 cookie 是 `SameSite=Strict`、`Path=/api/auth`、`Secure`，跨網站或
沒有 HTTPS 時瀏覽器不會送，使用者會一直被登出。

- [ ] 反向代理終結 TLS（只開 TLS 1.2 以上、強的 cipher suite；HTTP 只轉址到 HTTPS）。ASVS 9.1.1–9.1.3
- [ ] 路由：`/` → 前端的靜態檔案；`/api/*` → gateway（去掉 `/api` 前綴，跟 `vite.config.ts` 的 proxy 一樣）；`/ws/*` → notification-service（WebSocket upgrade）。
- [ ] 前端 build 時設 `VITE_WS_BASE_URL=wss://<網域>`（預設是開發用的 `ws://localhost:8085`）；`VITE_API_BASE_URL` 維持 `/api`。
- [ ] gateway 設 `FRONTEND_URL=https://<網域>`、`OAUTH_CALLBACK_BASE_URL=https://<網域>/api`，並把這個 callback 加進 Google／Notion 的 OAuth 設定。
- [ ] gateway 與 notification-service 設 `FORWARD_HEADERS_STRATEGY=native`（gateway）、`TRUSTED_PROXIES=<反向代理的位址>`（兩個都要）：
      限流看真正的來源 IP。**不要**信任所有位址——使用者自己填的 `X-Forwarded-For` 會讓每 IP 的限流失效。
- [ ] gateway 與 notification-service 只能經反向代理連到（不能繞過代理直接打）。
- [ ] 反向代理加 `Strict-Transport-Security: max-age=31536000; includeSubDomains`（ASVS 14.4.5）。

## 3. 前端靜態伺服器的標頭

gateway 的 API 回應已經自己帶安全標頭；前端頁面（`index.html` 與 JS／CSS）由提供靜態檔案的伺服器加。建議（nginx 寫法，`<storage>` 換成
物件儲存的網址，見第 5 節）：

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' wss://<網域>; media-src 'self' blob: https://<storage>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
autoindex off;
```

- [ ] 加上面的標頭（ASVS 14.4.3、14.4.4、14.4.6、14.4.7）。`style-src 'unsafe-inline'` 是因為 UI 元件用 inline style；上線前用瀏覽器的
      console 確認沒有被 CSP 擋掉的資源（播放器、WebSocket、字型）。
- [ ] 關掉目錄列表（`autoindex off`），只提供 build 出來的副檔名（`.html .js .css .woff2 .svg .ico .png`）；網站目錄只放 `npm run build` 的
      `dist/`，不要有 `.git` 或原始碼（ASVS 4.3.2、12.5.1）。
- [ ] `index.html` 設 `Cache-Control: no-cache`，帶雜湊的 JS／CSS 可以長期快取。

## 4. 網路隔離

服務之間的 gRPC 用 `x-user-id` metadata 傳使用者身分，**沒有再驗證**——能直接連到內部服務的人可以冒充任何使用者。

- [ ] 對外只開反向代理。auth-service（9091）、upload-service（9090）、transcription-service（8083）、ai-service（8084）、Postgres、Redis、
      RabbitMQ（含 15672 管理介面）、MinIO console（9001）都只在內部網路（Kubernetes 用 `ClusterIP` 加 NetworkPolicy：只有 gateway 能連 gRPC 服務）。
      ASVS 4.1.2、4.3.1
- [ ] 不要用 `infra/k8s` 的 NodePort（30080）對外；那是本機開發用的。
- [ ] 對外連線（egress）只開需要的網域（ASVS 12.6.1）：`api.deepgram.com`、`router.huggingface.co`（平台模型與 embedding；改用自架的
      OpenAI 相容端點時換成那個）、`mcp.tavily.com`（查網路、事實查核）、Google（`accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`、
      `gmail.googleapis.com`、`tasks.googleapis.com`）、`mcp.notion.com`；使用者可以存自己金鑰的廠商（`api.openai.com`、`api.anthropic.com`、
      `generativelanguage.googleapis.com`、`openrouter.ai`）。不用的功能就不開。

## 5. 物件儲存

- [ ] bucket 不開匿名讀取、不開列表；只用 presigned URL（ASVS 4.3.2、12.4.1）。
- [ ] 物件儲存放在**跟前端不同的網域**（例如 `storage.<網域>`），不要用同一個網域的子路徑：上傳的檔案目前沒有綁 Content-Type
      （`.scratch/pre-launch-hardening/issues/16`），同一個網域時存成 HTML 的檔案就能在前端的網域執行 script。票 16 做完之前這點一定要做。
- [ ] 物件儲存的 CORS 只允許前端的網域（瀏覽器直接 PUT 上傳、播放器直接讀）。

## 6. Container image 與依賴

- [ ] 每次發版前用 Grype 掃每個服務的 image（作業系統套件，語言套件的掃法見各服務 README「依賴套件弱點掃描」），高風險以上要先處理（ASVS 14.2.1）：
      `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock anchore/grype:latest transuai/gateway:<tag>`
- [ ] 之後每個月掃一次語言套件與 image。

## 7. 監控與維運

- [ ] Redis 要有監控與自動重啟：Redis 停掉時服務照常，但**登入限流與每人限流會失效**（fail-open，設計決定），而且每個請求多等約 0.5 秒。
- [ ] log 保留期限依客戶的政策；log 裡有 IP（限流）與 Job ID，不會有密碼或 token。
- [ ] 備份 Postgres（四個資料庫）與物件儲存；`KEY_ENCRYPTION_KEY` 跟資料庫備份分開存。
- [ ] DNS：不再使用的子網域記得刪掉 CNAME，避免被接管（ASVS 10.3.3）。

## 8. 個資與說明

- [ ] `/privacy` 列出了資料會送到哪些外部服務；部署的單位要補上自己的個資政策與聯絡窗口（`/privacy` 寫「請洽你的單位管理這套系統的人員」）。
- [ ] 確認要開的外部服務（Deepgram、HF、Tavily、Google、Notion）符合單位的規定；不用的功能就不設金鑰，對應的項目在 `/privacy` 也要跟著拿掉。
- [ ] 沒有忘記密碼的功能：使用者忘記密碼時目前只能由管理員處理（`.scratch/pre-launch-hardening/issues/19` 決定要不要做）。
