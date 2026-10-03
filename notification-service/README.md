# notification-service

音訊/影片逐字稿 + AI 分析平台的 Notification Service。消費 [`ai-service`](../ai-service) 發出的 `ai.completed`、以及 `ai-service`/[`transcription-service`](../transcription-service) 任一階段失敗時發出的 `job.failed` 事件，透過 WebSocket 即時推播 Job 狀態給前端。是整條非同步 pipeline 的最後一環（對照 [`../architecture-design.md`](../architecture-design.md) 1.2 核心資料流）。

跟其他內部服務不同，這個服務**沒有自己的資料庫**（對照 `architecture-design.md` 2.1，`Database per Service` 清單裡本來就沒有 `notification_db`）——純粹是 MQ → WebSocket 的即時轉發，不落地儲存,也不提供補推播/歷史查詢。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），FastAPI + `uvicorn`（只用來撐 WebSocket，沒有其他 REST API） |
| 消費 | RabbitMQ（`pika`），消費 `ai.completed` / `job.failed` |
| 推播 | WebSocket（`GET /ws/jobs/{jobId}`），依 `jobId` 分組管理連線,收到對應事件就廣播給訂閱該 job 的所有 client |
| 驗證 | 連上後第一則訊息帶 access token（`PyJWT` 本地驗章，跟 gateway 同一把 `JWT_SECRET`）；Job 是不是這位使用者的，gRPC 問 upload-service 的 `UploadService.GetJob` |

跟 [`ai-service`](../ai-service)、[`transcription-service`](../transcription-service) 一樣是 MQ 驅動的純內部服務,但這裡對前端開的是 WebSocket 而不是 gRPC——因為即時推播的對象是瀏覽器,架構文件裡這一段本來就是唯一直接對前端開放的內部服務端點（其餘查詢一律經 Gateway 轉發）。

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`（只需要 RabbitMQ）
- 訂閱時要問 upload-service（`localhost:9090`）Job 是誰的，它沒開的話連線會被關掉（`1011`），前端稍後重連

```bash
cp .env.example .env   # 第一次使用才需要，預設值就能跑
uv sync
```

## 啟動服務

```bash
uv run python -m app.main
```

啟動時會：

1. 開一條背景 thread 消費 RabbitMQ 的 `ai.completed` / `job.failed`（主要業務入口，MQ 驅動）；連線斷線（RabbitMQ 重啟、DNS 暫時解析失敗等）有指數退避自動重連，不會讓這條 thread 永久掛掉（見 `app/services/consumer.py`）
2. 起 `uvicorn`,監聽 `8085`,提供 `GET /health` 與 `WS /ws/jobs/{jobId}`

## Pipeline

```
前端連上 WS /ws/jobs/{jobId}
  → 這個來源 IP 的連線數超過上限 → 關閉（4429）
  → 等第一則訊息 { type: "auth", accessToken }（WS_AUTH_TIMEOUT_SECONDS 內），驗不過 → 關閉（4401）
  → 這位使用者的連線數超過上限 → 關閉（4429）
  → GetJob(jobId, x-user-id) 確認是這位使用者的 Job，不是 → 關閉（4404）；問不到 → 關閉（1011）
  → 依 jobId 註冊進 in-memory 連線表，回 { type: "subscribed", jobId }

消費 ai.completed { jobId, status }
  → 組裝 { jobId, status, progress: 100 }
  → 廣播給所有訂閱該 jobId 的連線

消費 job.failed { jobId, stage, errorReason }
  → 組裝 { jobId, status: "FAILED", stage, errorReason }
  → 廣播給所有訂閱該 jobId 的連線

任一事件處理完（不論廣播對象是否存在）都直接 ack,不 requeue——
沒有 client 在線只是單純沒人收到,不算處理失敗。
```

pika 是同步 library,MQ 消費跑在獨立 thread；收到訊息後用 `asyncio.run_coroutine_threadsafe`
把「廣播給 WebSocket」這個 async 動作丟回 `main.py` 啟動 `uvicorn` 用的那個 event loop 執行
（`app/services/consumer.py`）。

## WebSocket API

```
WS /ws/jobs/{jobId}   訂閱單一 Job 的狀態更新事件（對應 architecture-design.md 3.5）
```

連上之後第一則訊息要帶 access token——瀏覽器的 WebSocket 不能帶 `Authorization` 標頭，token 也不放網址（會留在存取紀錄裡）：

```json
{ "type": "auth", "accessToken": "<access token>" }
```

驗證通過、Job 是這位使用者的，才會回：

```json
{ "type": "subscribed", "jobId": "uuid" }
```

不通過就關閉連線，關閉代碼告訴前端要不要重連（見 `app/controllers/ws_controller.py`、frontend 的 `use-job-socket`）：

| 代碼 | 意思 | 前端 |
|---|---|---|
| `4401` | 沒在時限內送 token、格式不對，或 token 不能用（簽章、過期、不是 access token） | 換發 access token 後再連；換發失敗就是登入過期 |
| `4404` | 不是這位使用者的 Job，或不存在（跟 gateway 一樣不透露是哪一種） | 不再重連 |
| `4429` | 超過同時連線數上限（每位使用者 `WS_MAX_CONNECTIONS_PER_USER`，預設 10；每個來源 IP `WS_MAX_CONNECTIONS_PER_ADDRESS`，預設 20，還沒驗證的也算） | 隔久一點再連 |
| `1011` | 問不到 upload-service | 照常重連 |

token 只在連上時驗證一次，之後 token 過期不會把已經連上的連線關掉（推播的只有這個 Job 的狀態，跟建立連線時是同一位使用者）。
來源 IP 預設看直接連進來的位址、不看 `X-Forwarded-For`（使用者可以自己填）；在反向代理後面時把 `TRUSTED_PROXIES` 設成代理的位址。
client 送來的訊息超過 16 KiB 會直接斷線（只需要收一則帶 token 的訊息）。

推播事件格式：

```json
{ "jobId": "uuid", "status": "COMPLETED", "progress": 100 }
{ "jobId": "uuid", "status": "FAILED", "stage": "SUMMARIZING", "errorReason": "..." }
```

訂閱之後連線只用來單向接收推播,不處理 client 傳來的訊息內容。

### 測試方式

```bash
# 先訂閱（另開一個 terminal）：job_id 要是這位使用者的 Job，連上後貼上 auth 訊息（access token 從登入回應或前端拿）
websocat ws://localhost:8085/ws/jobs/<job_id>
{"type":"auth","accessToken":"<access token>"}

# 再手動發一則 ai.completed 到 RabbitMQ 觸發推播（可用 Management UI: http://localhost:15672）
```

## 專案結構

MVC 風格分層，跟 ai-service / transcription-service 對照方式一致，只是這裡的「Controller」是
WebSocket route 而不是 gRPC servicer：

```
app/
  main.py                       建立 FastAPI app、lifespan（起 consumer thread）、uvicorn entrypoint
  core/
    config.py                    pydantic-settings，讀 .env
    production.py                 正式環境的密鑰檢查
  controllers/
    ws_controller.py               WS /ws/jobs/{jobId} route：限連線數、驗 token、確認擁有者，再加入連線表
  services/
    consumer.py                     RabbitMQ consumer loop（pika），消費 ai.completed / job.failed
    connection_manager.py            依 jobId 分組管理目前連線的 WebSocket client，供 broadcast 用
    access_token.py                  驗證 access token（PyJWT），回傳使用者 id
    job_access.py                    gRPC 問 upload-service 的 GetJob：Job 是不是這位使用者的
    connection_limits.py              同時連線數上限（每位使用者、每個來源 IP），in-memory
  proto_gen/                      gRPC stub 產物（由 scripts/generate_grpc.sh 產生，有 commit 進版控）
scripts/generate_grpc.sh           重新產生 gRPC stub（只有 upload.proto）
tests/                            pytest：WebSocket 訂閱的驗證與上限、JobAccess（in-process gRPC server）、正式環境密鑰檢查
```

## 測試

```bash
uv run pytest
```

## 重新產生 gRPC stub

只用到 `upload.proto`（呼叫 upload-service 的 `UploadService.GetJob`）：

```bash
./scripts/generate_grpc.sh
```

## 正式環境（`APP_ENV=production`）

`APP_ENV` 預設是 `development`；設成 `production`時：

- 啟動前檢查密鑰（`app/core/production.py`）：`RABBITMQ_PASSWORD`、`JWT_SECRET` 沒設、還是開發用的預設值（`0000`、`admin`、`dev-only-…` 這類，跟 `infra/k8s/02-secret.yaml` 一致）、
  或太短（`RABBITMQ_PASSWORD` 少於 12 字元、`JWT_SECRET` 少於 32 字元），就不啟動，錯誤訊息列出是哪幾個環境變數。
- API 文件（`/docs`、`/redoc`、`/openapi.json`）不對外（`app/main.py` 的 `create_app`）。

開發環境都不檢查、照舊開著。見 `.scratch/pre-launch-hardening/issues/07`。

## 依賴套件弱點掃描

掃的是正式執行時會裝的依賴（跟 Dockerfile 的 `uv sync --no-dev` 一樣，不含 pytest 這類開發工具），用 [pip-audit](https://pypi.org/project/pip-audit/)
對照 PyPI／OSV 的弱點資料庫：

```bash
uv export --frozen --no-dev --no-hashes --no-emit-project --format requirements-txt > /tmp/requirements.txt
uvx pip-audit --no-deps --disable-pip -r /tmp/requirements.txt
```

上線前、以及之後每個月或升級依賴時跑一次。高風險、嚴重的要升級，或在這裡寫清楚為什麼不影響。

最近一次結果：2026-10-03：沒有已知弱點。

## 已知限制 / 待辦

- 連線狀態純 in-memory,服務重啟或多副本部署（水平擴展）時,連線表不會同步——重啟後所有 client 要
  重新連線；多副本情境下同一個 jobId 的訂閱者若分散在不同副本,事件只會送到收到 MQ 訊息那個副本手上
  的連線,無法跨副本廣播（要解就要引入 Redis Pub/Sub 或類似機制做副本間同步）
- 沒有補推播機制：client 斷線期間錯過的事件不會在重連後補送,也沒有落地儲存可查歷史狀態（要看
  最新狀態要另外呼叫 upload-service 的 Job 查詢 API）
- 同時連線數的計數是 in-memory、每個副本各算各的；多副本部署時上限實際上是「每個副本」的上限（要全域上限就要把計數搬到 Redis）
- consumer（MQ → 廣播）沒有自動化測試，目前只靠手動 smoke test；WebSocket 訂閱的驗證與上限有 pytest
