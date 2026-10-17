# 升級

資料庫的結構在服務啟動時自動升級（Python 服務用 Alembic、Java 服務用 Hibernate），不用手動跑 migration。升級前一定先備份。

## 從原始碼安裝的

```bash
cd transuai/infra/deploy
./backup.sh
git pull                       # 或 git checkout v1.2.0
./install.sh --images build    # 沿用 .env 與憑證，重新 build、重新啟動
```

## 用發行的 image

```bash
./backup.sh
# 改 .env 的 TRANSUAI_VERSION（例如 v1.2.0），並換上新版安裝包裡的 compose.yaml 與 edge/（看 Release 說明有沒有新的 .env 設定）
docker compose pull
docker compose up -d
```

## 確認

```bash
docker compose ps          # 都是 Up（postgres、redis、rabbitmq、minio 是 healthy）
docker compose logs --since 10m | grep -iE 'error|exception'
```

打開網頁登入，管理員到「系統設定」各按一次「檢查」。

## 退回上一版

資料庫結構升級後不一定能被舊版讀：退回時用升級前的備份還原（[backup.md](backup.md)），再把 `TRANSUAI_VERSION`（或 git）改回舊版
`docker compose up -d`。

## 本地模型

vLLM 的版本在 `.env` 的 `VLLM_VERSION`；換版本後 `docker compose --profile gpu pull && docker compose up -d`。模型權重在 volume
`transuai_vllm-models`，換模型時第一次啟動會下載新的。
