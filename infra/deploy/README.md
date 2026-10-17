# 安裝 TransuAI（一台伺服器，Docker Compose）

把 TransuAI 裝在單位內部的一台 Linux 伺服器上：整套服務（資料庫、佇列、物件儲存、六個服務、網頁）用 Docker Compose 跑，
資料都在 Docker volume；有 NVIDIA GPU 的話，聊天模型、embedding、語音辨識也可以一起在本機跑，完全不用連外。

| 文件 | 內容 |
| --- | --- |
| [docs/hardware.md](docs/hardware.md) | 硬體建議：CPU、記憶體、磁碟、GPU |
| [docs/tls.md](docs/tls.md) | 換成單位自己的憑證 |
| [docs/backup.md](docs/backup.md) | 備份與還原 |
| [docs/upgrade.md](docs/upgrade.md) | 升級到新版本 |
| [docs/offline.md](docs/offline.md) | 不能連外的環境 |

## 需要

- Linux（x86-64），Docker Engine 與 Docker Compose 2.23 以上、`openssl`、`curl`。
- 一個使用者連得到的網址：主機名（建議，例如 `transuai.corp.internal`）或 IP。**一定要 HTTPS**——登入用的 cookie 只能在 HTTPS 上。
  安裝時會產生自簽憑證，之後可以換成單位自己的。
- 本地模型（選用）：NVIDIA GPU（16GB 以上顯示記憶體）、驅動、[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)。

## 安裝

```bash
git clone <這個 repo> transuai && cd transuai/infra/deploy
./install.sh
```

`install.sh` 會：

1. 檢查 Docker 與 Compose。
2. 問網址，產生 `.env`：所有密鑰（資料庫、RabbitMQ、物件儲存、Redis、JWT、`KEY_ENCRYPTION_KEY`）都是隨機產生的，檔案權限 600。
3. 產生自簽憑證到 `tls/`。
4. 有 NVIDIA GPU 時問要不要一起跑本地模型（`COMPOSE_PROFILES=gpu`，模型網址自動填好）。
5. 從原始碼 build image（或 `--images pull` 用發行的 image、`--images load:<檔案>` 用離線包）。
6. 啟動，等到網頁可以開，印出網址。

不想被問的話：`./install.sh --url https://transuai.corp.internal --gpu --yes`（`--help` 看所有選項）。
從 GitHub Release 下載的安裝包（`transuai-deploy-<版本>.tar.gz`）不含原始碼，預設就用發行的 image。

再跑一次 `install.sh` 不會覆蓋已經有的 `.env` 與憑證。

## 裝好之後

1. 打開網址，**第一個註冊的帳號就是管理員**（註冊頁寫「建立管理員帳號」）。之後要多指定管理員：
   `docker compose exec -T postgres psql -U transuai -d auth_db -c "UPDATE users SET role='admin' WHERE email='someone@corp'"`
2. 管理員到「系統設定」：
   - **模型**：OpenAI 相容的伺服器（本地 vLLM、Claude、OpenAI、Gemini、OpenRouter）與模型，embedding 的伺服器與模型。
     用本地模型的話已經填好（`http://vllm-chat:8000/v1` 等）。模型伺服器跑在這台主機上、但不在 compose 裡時，填
     `http://host.docker.internal:<port>/v1`。
   - **語音辨識**：本地（OpenAI 相容的 `/v1/audio/transcriptions`，講者分離在 transcription-service 裡用 CPU 跑）或 Deepgram。
   - **寄信**：SMTP（可以寄測試信）。沒設定的話，忘記密碼改用復原碼、不做 email 確認。
   - 每一區都有「檢查」，確認連得上。存了馬上生效，不用重啟。
3. 本地模型第一次啟動要下載與載入（幾分鐘到幾十分鐘）：`docker compose logs -f vllm-chat`。三個模型依序啟動（每個要看到自己那份
   顯示記憶體是空的），在 RTX 5080 上模型已經下載好時約 10 分鐘。已經有下載好模型的 Docker volume 時，`.env` 設 `VLLM_MODELS_VOLUME`
   沿用它。
4. 從使用者的電腦跑一次 `../scripts/verify-deployment.sh <網址>`（TLS、轉址、安全標頭、內部的 port 連不到），要全部 PASS。

## 日常操作

都在這個目錄下執行：

```bash
docker compose ps                    # 各服務的狀態
docker compose logs -f ai-service    # 看某個服務的 log
docker compose restart edge          # 換了憑證之後
docker compose down                  # 停掉（資料留在 volume）
docker compose up -d                 # 再啟動
./backup.sh                          # 備份（見 docs/backup.md）
```

## 架構

```
瀏覽器 ──HTTPS──▶ edge（nginx，TLS）
                   ├─ /media-uploads/…  ─▶ minio（瀏覽器直接上傳、播放，用 presigned URL）
                   └─ 其他               ─▶ frontend（nginx：網頁；/api ─▶ gateway，/ws ─▶ notification-service）
gateway ─gRPC─▶ auth-service、upload-service、transcription-service、ai-service
transcription-service、ai-service ◀─RabbitMQ─▶ notification-service
postgres（pgvector）、redis、rabbitmq、minio；選用：vllm-chat、vllm-embed、vllm-stt
```

只有 edge 對外開 port（`.env` 的 `TRANSUAI_HTTPS_PORT`、`TRANSUAI_HTTP_PORT`；HTTP 只轉址到 HTTPS）。其他服務只在 compose 的內部網路
（`TRANSUAI_NET`，預設 `172.29.0.0/24`，跟單位的網段衝突時改）。服務都是 `APP_ENV=production`：密鑰太短或是開發用的預設值時
不會啟動，`docker compose logs <服務>` 會說是哪一個。

設定都在 `.env`（範本與說明見 [.env.example](.env.example)）；改了之後 `docker compose up -d` 讓用到它的服務重建。
