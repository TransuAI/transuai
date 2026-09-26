# infra

本機開發環境的基礎設施：PostgreSQL、Redis、RabbitMQ、MinIO，以及完整服務的 Kubernetes 部署。

## 目錄結構假設

所有 repo clone 在同一層：

```
projects/
  infra/                 <- 這個 repo
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

> Redis 目前沒有任何服務真的在用（保留給未來的 cache/rate limit），開著純粹是佔位，不影響現有功能。

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
2. Build 六個服務的 image（Java 服務的 build context 要是三個 repo 的共同上層目錄，因為 `build.gradle` 用 `srcDir '../infra/proto'` 讀共用 proto 定義；Python 服務的 `proto_gen` 已 commit 進版控，各自的 repo 目錄就夠）：
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
6. 把 `DEEPGRAM_API_KEY` / `HF_API_KEY` 從各自服務的 `.env` 補進 k8s secret、產生一把 `KEY_ENCRYPTION_KEY`，並重啟對應服務（secret 套用時預設留白，避免 API key 進版控）：
   ```bash
   kubectl -n transuai patch secret app-secrets --type merge -p \
     "{\"stringData\":{\"DEEPGRAM_API_KEY\":\"$(cut -d= -f2 <<< "$(grep ^DEEPGRAM_API_KEY= ../transcription-service/.env)")\"}}"
   kubectl -n transuai patch secret app-secrets --type merge -p \
     "{\"stringData\":{\"HF_API_KEY\":\"$(cut -d= -f2 <<< "$(grep ^HF_API_KEY= ../ai-service/.env)")\"}}"
   kubectl -n transuai patch secret app-secrets --type merge -p \
     "{\"stringData\":{\"KEY_ENCRYPTION_KEY\":\"$(openssl rand -base64 32)\"}}"
   kubectl -n transuai rollout restart deployment transcription-service ai-service
   ```
   `DEEPGRAM_API_KEY` 只有 transcription-service（語音辨識 + 講者分離）會用到；`HF_API_KEY` 是 ai-service 的
   摘要/章節/RAG 問答跟 embedding 用的（見 [`../ai-service/README.md`](../ai-service/README.md)）；`KEY_ENCRYPTION_KEY` 是 ai-service 加密使用者自有金鑰與已連結帳號權杖的主金鑰，產生後不要再換，換了之後已存的自有金鑰都解不開、已連結的帳號都會變成已失效。
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
| `forward.sh` | 一次開好前端開發要用的 port-forward：gateway `8080`、notification-service `8085`、minio `19000`。前景執行，`Ctrl-C` 全部關閉；對應 pod 重啟過的話連線會斷，重跑即可 |
| `rebuild.sh <service>...` / `--all` | 改了程式碼後用：build image -> `kind load` -> `rollout restart` |
| `restart.sh <service>...` / `--all` | 改了 `k8s/01-configmap.yaml` 或 `02-secret.yaml` 後用：重新 apply 設定並重啟，讓 pod 重新讀環境變數（只改程式碼用 `rebuild.sh`，不是這支） |
| `status.sh` | 快速看目前 context / nodes / pods / 正在跑的 port-forward |

`_env.sh` 是共用變數，被其他腳本 `.` source，不要直接執行。

### 重置環境

```bash
kubectl delete ns transuai
```

所有 volume 都是 `emptyDir`，namespace 砍掉資料就沒了，等於乾淨重來（要重新跑一次部署步驟）。
