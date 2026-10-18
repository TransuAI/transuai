# infra

本機開發環境的基礎設施：PostgreSQL、Redis、RabbitMQ、MinIO，以及完整服務的 Kubernetes 部署。

這裡的 `docker-compose.yaml` 與 `k8s/` 都是**本機開發用**的（預設密碼、NodePort、`emptyDir`）。客戶裝在自己的伺服器上用
[`deploy/`](deploy/README.md)：一台機器的 Docker Compose 安裝包（`install.sh` 產生密鑰與憑證，HTTPS、同一個網站、選用的本地模型都設好），
另外照 [`docs/deployment-checklist.md`](docs/deployment-checklist.md) 做程式碼做不到的事（換憑證、egress、image 掃描、監控）。

## 目錄結構

所有服務都在同一個 repo（monorepo）裡，各自一個目錄：

```
transuai/
  infra/                 <- 這個目錄（deploy/ 是客戶的安裝包，k8s/ 與 docker-compose.yaml 是本機開發用）
  auth-service/
  upload-service/
  transcription-service/
  ai-service/
  notification-service/
  gateway/
  frontend/
```

## 兩種本機執行模式

1. **只跑基礎設施，服務自己在 host 上跑**（`docker-compose`）——開發單一服務、要用 IDE 斷點/熱重載時用這個。
2. **整包丟進 Kubernetes 跑**（`k8s/`）——驗證多服務串接、確認 pipeline 整條通不通時用這個。這個模式下 Postgres/RabbitMQ/MinIO/Redis 也是各自用 StatefulSet/Deployment 開在叢集內，跟模式一的 `docker-compose` 是兩份獨立、互不相干的基礎設施，不要混用（例如模式一開著時又在模式二裡對同一顆本機 Postgres port 5432 有衝突的疑慮——實際上不會衝突，因為叢集內的 Postgres 只在叢集內部網路，但資料是分開的兩份，不要以為模式二寫進去的資料模式一看得到）。

---

## 模式一：docker-compose（基礎設施 only）

### 第一次使用

```bash
cp .env.example .env
# 編輯 .env
```

### 啟動基礎設施

```bash
docker compose up -d
```

- Postgres: `localhost:5432`（帳密見 `.env`，已自動建好 `auth_db` / `upload_db` / `transcription_db` / `ai_db` 四個資料庫，`ai_db` 已啟用 pgvector）
- Redis: `localhost:6379`
- RabbitMQ AMQP: `localhost:5672`，Management UI: `http://localhost:15672`（帳密見 `.env`）
- MinIO API: `localhost:9000`，Console: `http://localhost:9001`（帳密見 `.env`，已自動建好 `media-uploads` bucket）

啟動後所有基礎設施會掛在同一個名為 `app-network` 的 Docker network 上，供各微服務接入。

compose 裡每個服務都是 `restart: unless-stopped`：`up` 過一次之後，每次開 Docker Desktop 都會自動起來。用模式二（k8s）時
用不到這一套（ai-service 的測試自己用 Testcontainers 起臨時的 Postgres），記得停掉（只停容器、資料留在 volume，要用時
`docker compose start`）：

```bash
docker compose stop
```

> Redis 放 gateway 的限流計數與快取（見 [`../gateway/README.md`](../gateway/README.md)「限流」「快取」）與 transcription-service 的逐字稿快取（見 [`../transcription-service/README.md`](../transcription-service/README.md)）；沒開時限流放行、快取略過（照樣讀資料庫），不影響功能。上限 256MB，滿了淘汰最久沒用的（`allkeys-lru`，都是有效時間的東西）。

### 重置環境（清掉所有資料重來）

```bash
docker compose down -v
```

`-v` 會連 volume 一起刪掉，Postgres 的 init script 只在 volume 第一次建立時執行，所以要重新跑 init script（例如改了 `postgres-init/`）也要先做這個。

### 常用指令

```bash
# 看某個基礎設施服務的 log
docker compose logs -f rabbitmq

# 只重建/重啟單一基礎設施服務
docker compose up -d --build postgres

# 進 postgres 檢查資料
docker compose exec postgres psql -U devuser -d upload_db

# 進 rabbitmq 看 queue 狀態（或直接開瀏覽器 http://localhost:15672）
docker compose exec rabbitmq rabbitmqctl list_queues
```

---

## 模式二：Kubernetes（本機用 Docker Desktop 內建的 kind）

### 前置需求

- Docker Desktop 開啟 Kubernetes，用的是內建的 kind，會起三個節點的容器：`desktop-control-plane`、`desktop-worker`、`desktop-worker2`。
- `kubectl` 的 context **必須是 `docker-desktop`**：
  ```bash
  kubectl config current-context   # 要印出 docker-desktop
  kubectl config use-context docker-desktop   # 不是的話切過去
  ```
  常見誤區：如果這台機器之前另外裝過一顆獨立的 k3s（例如照舊版 `setup.sh` 裝的），kubeconfig 裡可能還留著一個叫 `default` 的 context 指到那顆舊叢集。兩個 context 長得都很正常，但完全是不同叢集——apply 到錯的 context 上不會報錯，只是東西全部起在你看不到、也用不到的地方，白忙一場。
- `kind` CLI 要能用（`kind get clusters` 應該要看到 `desktop`）。這點很重要：kind 的每個節點各自有獨立的 containerd image store，跟 host 用 `docker build` 產生的 image 是分開的兩份，即使 Docker Desktop 的 `docker build` 和這些節點背後是同一顆 Docker Engine，image 也不會自動同步進節點——**一定要額外用 `kind load docker-image` 載進去**，不然 pod 會 `ErrImageNeverPull`（manifests 裡全部服務都設定 `imagePullPolicy: Never`，因為沒架 registry）。

### 部署步驟

全部寫在 `k8s/setup.sh`，可以直接跑：

```bash
./k8s/setup.sh
```

它做的事（拆開列出來方便手動除錯用）：

1. 確認 context 是 `docker-desktop`。
2. Build 六個服務的 image（Java 服務的 build context 要是 repo 的根目錄，因為 `build.gradle` 用 `srcDir '../infra/proto'` 讀共用 proto 定義；Python 服務的 `proto_gen` 已 commit 進版控，各自的 repo 目錄就夠）：
   ```bash
   docker build -f "$ROOT_DIR/auth-service/Dockerfile" -t transuai/auth-service:dev "$ROOT_DIR"
   docker build -f "$ROOT_DIR/gateway/Dockerfile" -t transuai/gateway:dev "$ROOT_DIR"
   docker build -f "$ROOT_DIR/upload-service/Dockerfile" -t transuai/upload-service:dev "$ROOT_DIR"
   docker build -t transuai/transcription-service:dev "$ROOT_DIR/transcription-service"
   docker build -t transuai/ai-service:dev "$ROOT_DIR/ai-service"
   docker build -t transuai/notification-service:dev "$ROOT_DIR/notification-service"
   ```
3. 把六個 image 載進 kind 叢集的每個節點：
   ```bash
   for img in auth-service gateway upload-service transcription-service ai-service notification-service; do
     kind load docker-image "transuai/$img:dev" --name desktop
   done
   ```
4. 套用 manifests：`kubectl apply -f k8s`
5. 等待所有 StatefulSet/Deployment 就緒（Postgres/RabbitMQ/MinIO 第一次起會比較慢，`minio-init` job 要等它們先起來才會 complete）。
6. （改用 Deepgram 才需要，本機預設用 vLLM 的語音辨識）把 `DEEPGRAM_API_KEY` 從 transcription-service 的 `.env` 補進 k8s secret、產生一把 `KEY_ENCRYPTION_KEY`，並重啟對應服務（secret 套用時預設留白，避免 API key 進版控）：
   ```bash
   # 在 infra/ 目錄下執行。.env 找不到、或那個 key 是空的，就停下來不 patch（不會把空字串寫進 secret）。
   key=$(grep -m1 '^DEEPGRAM_API_KEY=' ../transcription-service/.env | cut -d= -f2-) && [ -n "$key" ] && \
     kubectl -n transuai patch secret app-secrets --type merge -p "{\"stringData\":{\"DEEPGRAM_API_KEY\":\"$key\"}}"
   kubectl -n transuai patch secret app-secrets --type merge -p \
     "{\"stringData\":{\"KEY_ENCRYPTION_KEY\":\"$(openssl rand -base64 32)\"}}"
   kubectl -n transuai rollout restart deployment transcription-service ai-service
   ```
   `DEEPGRAM_API_KEY` 只有 transcription-service（語音辨識 + 講者分離）會用到；ai-service 的模型（摘要/章節/RAG 問答跟 embedding）
   跑在本機的 vLLM、不用金鑰（見下面「模型跑在本機（vLLM）」）；`KEY_ENCRYPTION_KEY` 是 ai-service 加密使用者自有金鑰與已連結帳號權杖的主金鑰，產生後不要再換，換了之後已存的自有金鑰都解不開、已連結的帳號都會變成已失效。
7. （要連結 Google 帳號才需要）到 Google Cloud Console 建一個「網頁應用程式」OAuth client，已授權的重新導向 URI 填
   `http://localhost:5173/api/oauth/google/callback`（`01-configmap.yaml` 的 `OAUTH_CALLBACK_BASE_URL` + `/oauth/google/callback`），
   啟用 Calendar、Gmail、Tasks API，再把 client id / secret 補進 secret（Notion 不用事先申請，連結時自動註冊 client）：
   ```bash
   kubectl -n transuai patch secret app-secrets --type merge -p \
     '{"stringData":{"GOOGLE_OAUTH_CLIENT_ID":"<client id>","GOOGLE_OAUTH_CLIENT_SECRET":"<client secret>"}}'
   kubectl -n transuai rollout restart deployment ai-service
   ```
   Gmail 建立草稿的權限（`gmail.compose`）屬於 Google 的受限權限：應用程式通過 Google 的審查之前，只有 OAuth 同意畫面裡
   登記的測試使用者能連結。
8. （要讓問答能「查網路」才需要）到 [tavily.com](https://tavily.com) 申請一把 API key（平台付費，免費方案整個平台每月 1,000 次
   搜尋），補進 secret 後重啟 ai-service；沒設定時問答照常，只是不能查網路、前端不顯示開關：
   ```bash
   # 在 infra/ 目錄下執行；.env 找不到或 key 是空的就停下來不 patch。
   key=$(grep -m1 '^TAVILY_API_KEY=' ../ai-service/.env | cut -d= -f2-) && [ -n "$key" ] && \
     kubectl -n transuai patch secret app-secrets --type merge -p "{\"stringData\":{\"TAVILY_API_KEY\":\"$key\"}}"
   kubectl -n transuai rollout restart deployment ai-service
   ```

### 從本機用 localhost 存取

Gateway 的 k8s Service 是 NodePort 30080，**但 kind 節點只把 API server port 映射到 host，30080 不會自動能連**（跟真的裝在 host 上的單節點 k8s 不一樣）。要從本機打進去，得自己開一條 port-forward：

```bash
kubectl -n transuai port-forward svc/gateway 30080:8080
```

這條指令會佔用前景終端機；且如果 gateway pod 之後被重啟（換了新 pod），這條連線會斷掉要重開。想要背景常駐、斷線自動重連，可以自己包一個 systemd user service（`Restart=always`）或用 `nohup ... & disown`。

打通之後：

```bash
curl -i http://localhost:30080/auth/me    # 沒帶 token 預期回 401，代表服務有起來
```

- Swagger UI（gateway，唯一有實質內容的一個，其他服務都是純 gRPC 沒有 REST controller）：`http://localhost:30080/swagger-ui/index.html`
- OpenAPI JSON：`http://localhost:30080/v3/api-docs`

### 常用指令

```bash
kubectl -n transuai get pods
kubectl -n transuai logs -f deployment/gateway
kubectl -n transuai exec -it postgres-0 -- psql -U admin -d upload_db
kubectl -n transuai exec -it rabbitmq-0 -- rabbitmqctl list_queues

# 改了某個服務的程式碼後要重新部署：build image -> 重新 kind load -> 重啟 deployment
# （imagePullPolicy: Never，同一個 tag:dev 不會自動抓新版，一定要手動 rollout restart）
docker build -t transuai/auth-service:dev -f ../auth-service/Dockerfile ..
kind load docker-image transuai/auth-service:dev --name desktop
kubectl -n transuai rollout restart deployment/auth-service
```

上面這些手動步驟（以及本機接前端開發要開的 port-forward）都包成腳本放在 `scripts/`，呼叫端要先 `cd scripts` 再執行（用 `./xxx.sh`、`bash xxx.sh`、`sh xxx.sh` 都可以）：

| 腳本 | 用途 |
|---|---|
| `forward.sh` | 一次開好前端開發要用的 port-forward（前端的 nginx 也部署在叢集裡，要看部署包的樣子時另外 `kubectl -n transuai port-forward svc/frontend 8088:8080`）：gateway `8080`、notification-service `8085`、minio `19000`。前景執行，`Ctrl-C` 全部關閉；對應 pod 重啟過的話連線會斷，重跑即可 |
| `verify-deployment.sh <https://網址> [內部 host:port …]` | 在客戶環境驗收部署（TLS、標頭、CSP、不該提供的檔案、API 文件、內部的埠），每項 PASS／FAIL，見 `docs/deployment-checklist.md` 第 2 節 |
| `rebuild.sh <service>...` / `--all` | 改了程式碼後用：build image -> `kind load` -> `rollout restart` |
| `restart.sh <service>...` / `--all` | 改了 `k8s/01-configmap.yaml`（或用 `kubectl patch` 改了 secret）後用：重新 apply configmap 並重啟，讓 pod 重新讀環境變數。**不會**重新 apply `02-secret.yaml`（只在 secret 還不存在時建立）——裡面真的金鑰是空的，重新 apply 會把 patch 進去的蓋掉 |
| `status.sh` | 快速看目前 context / nodes / pods / 正在跑的 port-forward |
| `make-admin.sh <email>` | 把已經註冊的帳號設成管理員（能改系統設定）。全新安裝不用：本機開發時第一個註冊的帳號自動是管理員，安裝包（`deploy/`）安裝時就建立好管理員；這支給升級前就有使用者、或要多一位管理員的部署 |
| `vllm.sh up` / `status` / `logs` / `down` | 本機（地端）的模型伺服器：用 Docker 跑三個 vLLM（用 GPU）——聊天模型、embedding、語音辨識；見下面「模型跑在本機（vLLM）」 |

`_env.sh` 是共用變數，被其他腳本 `.` source，不要直接執行。

### 模型跑在本機（vLLM）

ai-service 的平台模型（摘要、章節、問答、會後處理）與 embedding 都指向 OpenAI 相容的伺服器，出廠不指向任何服務（見
`../ai-service/docs/adr/0015-self-hosted-vllm-for-platform-model-and-embeddings.md`）。本機 k8s 的 `01-configmap.yaml` 指向自己電腦上
用 Docker 跑的 vLLM，不用付 AI API 的錢、資料不出這台電腦：

```bash
./scripts/vllm.sh up
```

| 服務 | 模型 | 埠 | 佔整張卡的比例 |
|---|---|---|---|
| embedding | `Qwen/Qwen3-Embedding-0.6B`（1024 維） | `8001` | 0.12 |
| 語音辨識 | `MediaTek-Research/Breeze-ASR-25`（台灣華語、中英夾雜；fp8） | `8002` | 0.16 |
| 聊天（平台模型、會後處理） | `Qwen/Qwen3-8B-AWQ`（4-bit，context 28672） | `8000` | 0.53 |

- 需要 NVIDIA 顯示卡，而且 Docker Desktop 能用 GPU（`docker run --rm --gpus all ubuntu:24.04 nvidia-smi` 看得到顯示卡）。RTX 50 系列
  （Blackwell）要用 vLLM v0.31.0 以後的官方 image（腳本預設 `vllm/vllm-openai:v0.31.0`）。
- 第一次會下載 vLLM 的映像檔（解開後約 32GB）與模型權重（約 9GB，從 Hugging Face Hub 下載；推論都在本機），存在 Docker volume
  `transuai-vllm-models`，之後不用重新下載；容器設成 Docker 重開後自動啟動。
- 預設值是在 RTX 5080（16GB）上實測的：三個都起來用了約 15GB、三個同時忙的尖峰 15.7GB（Windows 桌面本身約 1.8GB）。換別張卡或別的
  模型，用環境變數調（`VLLM_CHAT_MODEL`、`VLLM_CHAT_GPU_SHARE`、`VLLM_CHAT_MAX_LEN`、`VLLM_EMBED_*`、`VLLM_STT_*`，見腳本開頭），
  模型名稱也要跟 `01-configmap.yaml` 一致。
- pod 經由 `http://host.docker.internal:8000/v1`（聊天）與 `:8001/v1`（embedding）連到它們。改了 `01-configmap.yaml` 要跑
  `./scripts/restart.sh ai-service`。換了 embedding 模型，ai-service 重啟時會在背景把既有的向量重算一遍。
- transcription-service 經由 `http://host.docker.internal:8002/v1` 用語音辨識（`STT_BASE_URL`），講者分離在它自己的 pod 裡用 CPU 跑；一小時的錄音約 20 分鐘（見 `../transcription-service/docs/adr/0003-local-speech-recognition-and-diarization.md`）。

### 重置環境

```bash
kubectl delete ns transuai
```

所有 volume 都是 `emptyDir`，namespace 砍掉資料就沒了，等於乾淨重來（要重新跑一次部署步驟）。
