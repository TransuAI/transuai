# infra

本機開發環境的基礎設施：PostgreSQL、Redis、RabbitMQ、MinIO。

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

## 第一次使用

```bash
cp .env.example .env
# 編輯 .env
```

## 啟動基礎設施

```bash
docker compose up -d
```

- Postgres: `localhost:5432`（帳密見 `.env`，已自動建好 `auth_db` / `upload_db` / `transcription_db` / `ai_db` 四個資料庫，`ai_db` 已啟用 pgvector）
- Redis: `localhost:6379`
- RabbitMQ AMQP: `localhost:5672`，Management UI: `http://localhost:15672`（帳密見 `.env`）
- MinIO API: `localhost:9000`，Console: `http://localhost:9001`（帳密見 `.env`，已自動建好 `media-uploads` bucket）

啟動後所有基礎設施會掛在同一個名為 `app-network` 的 Docker network 上，供各微服務接入。

## 重置環境（清掉所有資料重來）

```bash
docker compose down -v
```

`-v` 會連 volume 一起刪掉，Postgres 的 init script 只在 volume 第一次建立時執行，所以要重新跑 init script（例如改了 `postgres-init/`）也要先做這個。

## 常用指令

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