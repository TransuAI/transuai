# 安裝 TransuAI（一台伺服器，Docker Compose）

把 TransuAI 裝在單位內部的一台 Linux 伺服器上：整套服務（資料庫、佇列、物件儲存、六個服務、網頁）用 Docker Compose 跑，
資料都在 Docker volume。模型（聊天、embedding、語音辨識）不在這台跑：另外部署（例如單位的一台 GPU 伺服器上的 vLLM），
裝好之後在「系統設定」頁填網址。

| 文件 | 內容 |
| --- | --- |
| [docs/models.md](docs/models.md) | 模型伺服器：要什麼、在 GPU 伺服器上用 vLLM 跑的參考做法、系統設定頁怎麼填 |
| [docs/hardware.md](docs/hardware.md) | 硬體建議：CPU、記憶體、磁碟 |
| [docs/tls.md](docs/tls.md) | 換成單位自己的憑證 |
| [docs/backup.md](docs/backup.md) | 備份與還原 |
| [docs/upgrade.md](docs/upgrade.md) | 升級到新版本 |
| [docs/offline.md](docs/offline.md) | 不能連外的環境 |

## 需要

- Linux（x86-64），Docker Engine 與 Docker Compose 2.23 以上、`openssl`、`curl`。
- 一個使用者連得到的網址：主機名（建議，例如 `transuai.corp.internal`）或 IP。**一定要 HTTPS**——登入用的 cookie 只能在 HTTPS 上。
  安裝時會產生自簽憑證，之後可以換成單位自己的。
- 模型伺服器：OpenAI 相容的聊天、embedding、語音辨識（見 [docs/models.md](docs/models.md)）；可以裝好 TransuAI 之後再準備。

## 安裝

```bash
git clone <這個 repo> transuai && cd transuai/infra/deploy
./install.sh
```

`install.sh` 會：

1. 檢查 Docker 與 Compose。
2. 問網址與管理員的 email，產生 `.env`：所有密鑰（資料庫、RabbitMQ、物件儲存、Redis、JWT、`KEY_ENCRYPTION_KEY`）與管理員的初始密碼都是
   隨機產生的，檔案權限 600。
3. 產生自簽憑證到 `tls/`。
4. 從原始碼 build image（或 `--images pull` 用發行的 image、`--images load:<檔案>` 用離線包）。
5. 啟動，等到網頁可以開。
6. 印出網址與**管理員的帳號、初始密碼**。

不想被問的話：`./install.sh --url https://transuai.corp.internal --admin-email it@corp.internal --yes`（`--help` 看所有選項）。
從 GitHub Release 下載的安裝包（`transuai-deploy-<版本>.tar.gz`）不含原始碼，預設就用發行的 image。

再跑一次 `install.sh` 不會覆蓋已經有的 `.env` 與憑證。

## 裝好之後

1. 打開網址，用安裝時印出來的管理員帳號與初始密碼登入，**先設定自己的密碼**（換好之前什麼都不能做；初始密碼也記在 `.env` 的
   `INITIAL_ADMIN_PASSWORD`，只在還沒有任何帳號時用來建立管理員，換過之後就沒用了，可以從 `.env` 刪掉）。其他人自己到網頁註冊（一般使用者）。
   之後要多指定管理員：
   `docker compose exec -T postgres psql -U transuai -d auth_db -c "UPDATE users SET role='admin' WHERE email='someone@corp'"`
2. 管理員到「系統設定」：
   - **模型**：聊天模型與 embedding 的伺服器（OpenAI 相容：單位自己的 vLLM，或 Claude、OpenAI、Gemini、OpenRouter）、金鑰與模型。
     怎麼準備、怎麼填見 [docs/models.md](docs/models.md)。模型伺服器跟 TransuAI 在同一台時填 `http://host.docker.internal:<port>/v1`。
   - **語音辨識**：OpenAI 相容的 `/v1/audio/transcriptions`（講者分離在 transcription-service 裡用 CPU 跑）或 Deepgram。
   - **寄信**：SMTP（可以寄測試信）。沒設定的話，忘記密碼改用復原碼、不做 email 確認。
   - 每一區都有「檢查」，確認連得上。存了馬上生效，不用重啟。設定好之前上傳的檔案會失敗，說「語音辨識尚未設定」。
3. 從使用者的電腦跑一次 `../scripts/verify-deployment.sh <網址>`（TLS、轉址、安全標頭、內部的 port 連不到），要全部 PASS。

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
postgres（pgvector）、redis、rabbitmq、minio
transcription-service、ai-service ──HTTP──▶ 模型伺服器（系統設定頁填的；不在這個 compose 裡）
```

只有 edge 對外開 port（`.env` 的 `TRANSUAI_HTTPS_PORT`、`TRANSUAI_HTTP_PORT`；HTTP 只轉址到 HTTPS）。其他服務只在 compose 的內部網路
（`TRANSUAI_NET`，預設 `172.29.0.0/24`，跟單位的網段衝突時改）。服務都是 `APP_ENV=production`：密鑰太短或是開發用的預設值時
不會啟動，`docker compose logs <服務>` 會說是哪一個。

設定都在 `.env`（範本與說明見 [.env.example](.env.example)）；改了之後 `docker compose up -d` 讓用到它的服務重建。
