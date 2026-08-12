# notification-service

音訊/影片逐字稿 + AI 分析平台的 Notification Service。消費 [`ai-service`](../ai-service) 發出的 `ai.completed`、以及 `ai-service`/[`transcription-service`](../transcription-service) 任一階段失敗時發出的 `job.failed` 事件，透過 WebSocket 即時推播 Job 狀態給前端。是整條非同步 pipeline 的最後一環（對照 [`../architecture-design.md`](../architecture-design.md) 1.2 核心資料流）。

跟其他內部服務不同，這個服務**沒有自己的資料庫**（對照 `architecture-design.md` 2.1，`Database per Service` 清單裡本來就沒有 `notification_db`）——純粹是 MQ → WebSocket 的即時轉發，不落地儲存,也不提供補推播/歷史查詢。

## 技術棧

| 項目 | 選擇 |
|---|---|
| 框架 | Python（`uv` 管理依賴），FastAPI + `uvicorn`（只用來撐 WebSocket，沒有其他 REST API） |
| 消費 | RabbitMQ（`pika`），消費 `ai.completed` / `job.failed` |
| 推播 | WebSocket（`GET /ws/jobs/{jobId}`），依 `jobId` 分組管理連線,收到對應事件就廣播給訂閱該 job 的所有 client |

跟 [`ai-service`](../ai-service)、[`transcription-service`](../transcription-service) 一樣是 MQ 驅動的純內部服務,但這裡對前端開的是 WebSocket 而不是 gRPC——因為即時推播的對象是瀏覽器,架構文件裡這一段本來就是唯一直接對前端開放的內部服務端點（其餘查詢一律經 Gateway 轉發）。

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`（只需要 RabbitMQ）

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
前端連上 WS /ws/jobs/{jobId} → 依 jobId 註冊進 in-memory 連線表

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

推播事件格式：

```json
{ "jobId": "uuid", "status": "COMPLETED", "progress": 100 }
{ "jobId": "uuid", "status": "FAILED", "stage": "SUMMARIZING", "errorReason": "..." }
```

連線只用來單向接收推播,不處理 client 傳來的訊息內容。

### 測試方式

```bash
# 先訂閱（另開一個 terminal，job_id 隨意，因為目前沒做 job 存在性驗證）
websocat ws://localhost:8085/ws/jobs/<job_id>

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
  controllers/
    ws_controller.py               WS /ws/jobs/{jobId} route
  services/
    consumer.py                     RabbitMQ consumer loop（pika），消費 ai.completed / job.failed
    connection_manager.py            依 jobId 分組管理目前連線的 WebSocket client，供 broadcast 用
```

## 已知限制 / 待辦

- 連線狀態純 in-memory,服務重啟或多副本部署（水平擴展）時,連線表不會同步——重啟後所有 client 要
  重新連線；多副本情境下同一個 jobId 的訂閱者若分散在不同副本,事件只會送到收到 MQ 訊息那個副本手上
  的連線,無法跨副本廣播（要解就要引入 Redis Pub/Sub 或類似機制做副本間同步）
- 沒有補推播機制：client 斷線期間錯過的事件不會在重連後補送,也沒有落地儲存可查歷史狀態（要看
  最新狀態要另外呼叫 upload-service 的 Job 查詢 API）
- 沒有驗證 `jobId` 是否存在或是否屬於發起連線的使用者（目前沒有 Auth Service,先不做）
- 沒有測試，目前只靠手動 smoke test
