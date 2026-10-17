# 客戶內部部署的清單

TransuAI 由客戶部署在自己的環境（2026-10-17 決定）。這份清單是程式碼**做不到、要在部署環境做**的事，來自上線前驗證
（`.scratch/pre-launch-hardening/asvs-l1.md` 標「部署時要做」的項目，與 `issues/01`、`09`、`11` 留下的事項）。上線前逐項打勾。

**用安裝包（`infra/deploy`，Docker Compose）裝的話**，這些已經做好：第 1 節的密鑰與 `APP_ENV=production`（`install.sh` 隨機產生）、第 2 節的
TLS（`edge`）、同一個網站、前端與 gateway 的網址與來源 IP 設定、第 4 節只對外開 `edge`、第 5 節私有的 bucket、第 7 節的備份（`backup.sh`）。
還要自己做的：換成單位的憑證（`infra/deploy/docs/tls.md`）、`verify-deployment.sh`、egress 限制、image 掃描、監控、個資說明。

## 1. 密鑰與正式環境的設定

- [ ] 每個服務設 `APP_ENV=production`：啟動時檢查自己的密鑰（沒設、是開發用的預設值、或太短就不啟動，並說出是哪個環境變數），
      並關掉 Swagger／API 文件與 gRPC reflection。
- [ ] 換掉 `infra/k8s/02-secret.yaml` 的每一個值：`DB_PASSWORD`／`POSTGRES_PASSWORD`、`RABBITMQ_PASSWORD`、`STORAGE_SECRET_KEY`／`MINIO_ROOT_PASSWORD`
      （至少 12 字元），`JWT_SECRET`（至少 32 字元，隨機產生，auth-service、gateway、notification-service 用同一把），`REDIS_PASSWORD`，
      `KEY_ENCRYPTION_KEY`（自有金鑰與 OAuth 權杖的主金鑰，**遺失就解不開已存的金鑰**，要另外備份），外部服務的金鑰（`DEEPGRAM_API_KEY`、
      `TAVILY_API_KEY`、`GOOGLE_OAUTH_*`）。
- [ ] 寄信：管理員在「系統設定」頁填單位的郵件伺服器（STARTTLS），或用環境變數（`SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、
      `MAIL_FROM`）。沒設的話畫面不顯示「忘記密碼」與 email 確認，改用復原碼，改密碼的通知信也不寄。
- [ ] 轉錄的上限（`app-config` 的 `USAGE_LIMIT_TRANSCRIPTION_MINUTES`、`MAX_RECORDING_MINUTES`）依單位的需要調；gateway 與 transcription-service 讀同一個值。
- [ ] secret 建好之後用 `kubectl patch` 一個一個改，**不要重新 `kubectl apply` 整份 `02-secret.yaml`**（會把改過的值蓋回空字串）。
- [ ] 密鑰不進版控、不放進 image；用客戶環境的 secret 管理（Kubernetes Secret、Vault 等）。

## 2. 網址、TLS 與反向代理

前端、API、WebSocket 放在**同一個網站**（同一個網域）：refresh token 的 cookie 是 `__Host-refresh_token`（`SameSite=Strict`、`Path=/`、`Secure`），跨網站或
沒有 HTTPS 時瀏覽器不會送，使用者會一直被登出。

TransuAI 附了前端的 image（`transuai/frontend`，`frontend/Dockerfile`，k8s 是 `infra/k8s/26-frontend.yaml`）：nginx 提供頁面，同一個網站把 `/api/*`
（去掉 `/api`）轉給 gateway、`/ws/*` 轉給 notification-service，頁面的安全標頭、CSP、只提供允許的檔案都已經設好（第 3 節）。單位只要在它前面放
一層終結 TLS 的反向代理。

- [ ] 前面那層反向代理終結 TLS（TLS 1.2 以上、強的 cipher；HTTP 只轉址到 HTTPS）：範本是 `frontend/nginx/tls.conf.example`（Mozilla intermediate）。
      ASVS 9.1.1–9.1.3。HSTS 前端與 gateway 都已經帶（14.4.5）。
- [ ] 前端的環境變數：`GATEWAY_URL`、`NOTIFICATION_URL`（k8s 的 Service，預設就是）、`STORAGE_ORIGIN`（瀏覽器連物件儲存的網址，跟
      `STORAGE_PUBLIC_ENDPOINT` 一樣，進 CSP）、`TRUSTED_PROXY_CIDR`（前面那層代理的位址，只信它帶的 `X-Forwarded-For`）。
- [ ] gateway 設 `FRONTEND_URL=https://<網域>`、`OAUTH_CALLBACK_BASE_URL=https://<網域>/api`，並把這個 callback 加進 Google／Notion 的 OAuth 設定；
      auth-service 的 `FRONTEND_URL` 一樣（重設密碼信裡的連結）。
- [ ] 來源 IP：前端的 nginx 把真正的來源放在 `X-Forwarded-For` 轉給後面。gateway 設 `FORWARD_HEADERS_STRATEGY=native`、`TRUSTED_PROXIES=<前端 pod
      的網段，正規表示式>`；notification-service 設 `TRUSTED_PROXIES=<同一個網段，CIDR>`（`infra/k8s/25-gateway.yaml`、`24-notification-service.yaml`
      有 kind 的寫法）。**不要**信任所有位址——使用者自己填的 `X-Forwarded-For` 會讓每 IP 的限流失效。
- [ ] gateway 與 notification-service 只能經前端的 nginx 連到（不能繞過代理直接打）。
- [ ] 部署好之後從使用者的網路跑一次 `infra/scripts/verify-deployment.sh https://<網域> <內部的 host:port …>`：TLS 版本與 cipher、HTTP 轉址、
      HSTS、安全標頭與 CSP、`Server` 不露版本、不提供 `.git`／`.env`／原始碼、API 文件不對外、內部的埠連不到。要全部 PASS。

## 3. 前端頁面的標頭（前端的 image 已經設好）

`frontend/nginx/default.conf.template` 與 `page-headers.conf`：頁面與檔案都帶 CSP（`script-src 'self'`，連線只到自己的網站與物件儲存，
`frame-ancestors 'none'`）、`nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、`Cross-Origin-Opener-Policy`、HSTS；
`server_tokens off`；只提供 `/assets/` 底下的 `.js .css .woff2 .svg .png` 與 `favicon.svg`，其他路徑一律給 `index.html`（image 裡沒有原始碼或
`.git`）；`index.html` 不快取、帶雜湊的檔案長期快取；請求本文最多 1MB（上傳是瀏覽器直接 PUT 到物件儲存）。ASVS 4.3.2、12.5.1、14.3.3、14.4。

- [ ] 不用附的 image、自己提供前端檔案的話，照上面兩個檔案設定一樣的標頭與規則。
- [ ] 上線前用瀏覽器打開一次，看 console 有沒有被 CSP 擋掉的東西（播放器、WebSocket、字型、上傳）。

## 4. 網路隔離

服務之間的 gRPC 用 `x-user-id` metadata 傳使用者身分，**沒有再驗證**——能直接連到內部服務的人可以冒充任何使用者。

- [ ] 對外只開反向代理。auth-service（9091）、upload-service（9090）、transcription-service（8083）、ai-service（8084）、Postgres、Redis、
      RabbitMQ（含 15672 管理介面）、MinIO console（9001）都只在內部網路（Kubernetes 用 `ClusterIP` 加 NetworkPolicy：只有 gateway 能連 gRPC 服務）。
      ASVS 4.1.2、4.3.1
- [ ] 不要用 `infra/k8s` 的 NodePort（30080）對外；那是本機開發用的。
- [ ] ai-service 與 transcription-service 在程式裡已經只連允許的網域（`OUTBOUND_ALLOWED_HOSTS`，預設是用到的服務，見各自 README）；不用的廠商
      可以從清單拿掉。網路層也建議同樣限制（多一層）。
- [ ] 對外連線（egress）只開需要的網域（ASVS 12.6.1）：`api.deepgram.com`、系統設定頁填的模型與語音辨識伺服器
      （自架在內部的 vLLM 不用開）、`mcp.tavily.com`（查網路、事實查核）、Google（`accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`、
      `gmail.googleapis.com`、`tasks.googleapis.com`）、`mcp.notion.com`；使用者可以存自己金鑰的廠商（`api.openai.com`、`api.anthropic.com`、
      `generativelanguage.googleapis.com`、`openrouter.ai`）。不用的功能就不開。

## 5. 物件儲存

- [ ] bucket 不開匿名讀取、不開列表；只用 presigned URL（ASVS 4.3.2、12.4.1）。
- [ ] 物件儲存建議放在**跟前端不同的網域**（例如 `storage.<網域>`）。安裝包為了只要一張憑證、一個網址，預設放在同一個網站的 bucket 路徑
      （`/media-uploads/`，edge 轉給 MinIO）；要分開的話改 `STORAGE_PUBLIC_ENDPOINT` 與 edge 的設定，再加一張憑證。上傳時 Content-Type 已經綁進簽章、只能是音訊或影片，播放時舊的
      非媒體物件也強制回 `application/octet-stream`；分開網域是多一層保險。
- [ ] 物件儲存的 CORS 只允許前端的網域（瀏覽器直接 PUT 上傳、播放器直接讀）。跟前端同一個網站時不用 CORS。

## 6. Container image 與依賴

- [ ] 每次發版前用 Grype 掃每個服務的 image（作業系統套件，語言套件的掃法見各服務 README「依賴套件弱點掃描」），高風險以上要先處理（ASVS 14.2.1）：
      `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock anchore/grype:latest transuai/gateway:<tag>`
- [ ] 之後每個月掃一次語言套件與 image。

## 7. 監控與維運

- [ ] Redis 要有監控與自動重啟：Redis 停掉時服務照常，但**登入限流與每人限流會失效**、登出後的 access token 在過期前（最多 15 分鐘）又能用（fail-open，設計決定），而且每個請求多等約 0.5 秒。
- [ ] log 保留期限依客戶的政策；log 裡有 IP（限流）與 Job ID，不會有密碼或 token。
- [ ] 備份 Postgres（四個資料庫）與物件儲存；`KEY_ENCRYPTION_KEY` 跟資料庫備份分開存。
- [ ] DNS：不再使用的子網域記得刪掉 CNAME，避免被接管（ASVS 10.3.3）。

## 8. 個資與說明

- [ ] `/privacy` 列出了資料會送到哪些外部服務；部署的單位要補上自己的個資政策與聯絡窗口（`/privacy` 寫「請洽你的單位管理這套系統的人員」）。
- [ ] 確認要開的外部服務（外部的模型與語音辨識服務、Deepgram、Tavily、Google、Notion）符合單位的規定；不用的功能就不設金鑰，對應的項目在 `/privacy` 也要跟著拿掉。
- [ ] 上傳的檔案**沒有掃毒**（使用者決定，`.scratch/pre-launch-hardening/issues/19`）：檔案只會送去轉錄、給上傳者本人播放與下載。單位規定要掃的話，
      在物件儲存那一層接（例如 bucket 的事件觸發 ClamAV）。
- [ ] 忘記密碼：重設信只寄給確認過的 email（註冊時寄確認信），要設好寄信（第 1 節）；收不到信時可以用復原碼。在設定 SMTP 之前就註冊的帳號
      要到設定頁「重寄確認信」；請使用者在設定頁產生復原碼、存好。
