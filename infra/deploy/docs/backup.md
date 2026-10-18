# 備份與還原

## 要備份什麼

| 內容 | 在哪裡 |
| --- | --- |
| 四個資料庫（帳號、檔案、逐字稿、摘要與問答、系統設定） | volume `transuai_postgres-data` |
| 上傳的錄音與影片 | volume `transuai_minio-data` |
| `.env`（所有密鑰，包括 `KEY_ENCRYPTION_KEY`） | 這個目錄 |
| 憑證 | `tls/` |

**`.env` 一定要跟資料庫一起備份**：系統設定頁存的 API key、SMTP 密碼、使用者自己的金鑰與 OAuth 權杖都用 `KEY_ENCRYPTION_KEY`
加密，沒有它就解不開。redis（限流與快取）、rabbitmq（處理中的訊息）不用備份。

## 備份

```bash
./backup.sh                # 放在 backups/<時間>/
./backup.sh /mnt/nas/transuai
```

服務不用停。每個資料庫一個 `pg_dump` 檔、上傳的檔案一個 tar、`.env` 與憑證。備份裡有密鑰：目錄權限是 700，另外存一份在
別台機器。可以用 cron 每天跑，例如：

```
0 3 * * * cd /opt/transuai/infra/deploy && ./backup.sh /mnt/nas/transuai >> /var/log/transuai-backup.log 2>&1
```

備份時有人正在上傳的話，那個檔案可能不完整（資料庫裡也還沒有它的紀錄，不影響其他檔案）。

## 還原（新的機器，或資料壞了）

在這個目錄下，`B` 是備份的目錄：

```bash
B=/mnt/nas/transuai/20261018-030000

# 1. 設定與憑證（新機器先準備好同一版的安裝目錄與 image：./install.sh 會產生新的 .env，所以不要先跑它）
cp "$B/env" .env && chmod 600 .env
tar xzf "$B/tls.tar.gz"

# 2. 只啟動資料庫與物件儲存（全新的 volume 會先建好空的資料庫）
docker compose up -d postgres minio

# 3. 資料庫（等 postgres 好了再做）
for db in auth_db upload_db transcription_db ai_db; do
  docker compose exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $db --clean --if-exists --no-owner" < "$B/$db.dump"
done

# 4. 上傳的檔案
docker compose stop minio
docker run --rm -i --volumes-from "$(docker compose ps -aq minio)" pgvector/pgvector:pg16 tar xzf - -C /data < "$B/minio-data.tar.gz"

# 5. 全部啟動
docker compose up -d
```

在原本的機器上還原（資料壞了）時，先停掉並刪掉舊的資料 volume（**會刪掉現在的資料**，確定備份是好的再做）：

```bash
docker compose down
docker volume rm transuai_postgres-data transuai_minio-data transuai_redis-data transuai_rabbitmq-data
```
