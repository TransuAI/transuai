# transcription-service

音訊/影片逐字稿 + AI 分析平台的 Transcription Service。消費 Upload Service 發出的 `transcription.requested` 事件，抽音軌、做轉錄與**講者分離**（地端：自架 vLLM 的 Breeze-ASR-25 加上在 CPU 上跑的講者分離；或雲端的 Deepgram，見 [ADR 0003](docs/adr/0003-local-speech-recognition-and-diarization.md)）、切成片段後把逐字稿存進自己的 `transcription_db`（每次轉錄也記一筆轉錄用量），並回寫 Job 狀態、發送 `transcription.completed` 事件給下游的 AI Service；也保存使用者對逐字稿的**編輯**（見 [`CONTEXT.md`](CONTEXT.md)）。是純內部服務（轉錄由 MQ 驅動），只暴露 gRPC 給其他內部服務查詢與編輯——只有 Gateway 才對前端提供 REST，服務跟服務之間一律走 gRPC（跟 [`upload-service`](../upload-service) 一致）。

## 技術棧

| 項目          | 選擇                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 框架          | Python（`uv` 管理依賴），原生 `grpcio` server，不用 web framework                                                                                |
| API           | gRPC（`TranscriptionService`），開發階段開放 [reflection](https://grpc.io/docs/guides/reflection/)，標準 `grpc.health.v1.Health` 做 health check |
| 消費          | RabbitMQ（`pika`），消費 `transcription.requested`，發送 `transcription.completed` / `job.failed`；使用者編輯逐字稿後發送 `transcript.edited`     |
| 轉錄 + 講者分離（地端） | `STT_BASE_URL`／`STT_MODEL` 有設定時：先在這個服務裡用 CPU 分講者（sherpa-onnx：pyannote segmentation-3.0 的 ONNX＋3D-Speaker CAM++，模型打包在 image 的 `/app/models/diarization`，門檻 `DIARIZATION_THRESHOLD` 預設 0.6），每段講者的話（最長 30 秒）再送到自架 vLLM 的 OpenAI 相容 `/v1/audio/transcriptions`（`MediaTek-Research/Breeze-ASR-25`），拿回片段的起訖時間，見 [ADR 0003](docs/adr/0003-local-speech-recognition-and-diarization.md)。約 3 倍速 |
| 轉錄 + 講者分離（雲端） | 沒設本地、有 `DEEPGRAM_API_KEY` 時：Deepgram Nova-3（語言依上傳時的選擇：中文 `zh-TW`（預設）、英文 `en` 或自動偵測中英文，見 [ADR 0002](docs/adr/0002-transcription-language-chosen-at-upload.md)；`httpx` 直接打 REST API），每個字的 timestamp 與講者；為什麼不是 Groq Whisper 見 [ADR 0001](docs/adr/0001-deepgram-replaces-groq-for-transcription-and-diarization.md) |
| 影片抽音軌    | moviepy（底層用 ffmpeg，經 `imageio-ffmpeg` 首次執行時自動下載 binary，本機不需另外安裝系統 ffmpeg）                                             |
| 繁體轉換      | OpenCC（`opencc`，`s2tw` 逐字轉台灣標準字形，離線執行、預編譯 wheel），只套用在中文逐字稿                                                         |
| 資料庫        | PostgreSQL（`transcription_db`），SQLAlchemy；schema 用 Alembic 版本化 migration（`app/db/migrations`），服務啟動時自動升級                        |
| 物件儲存      | S3 相容 API（`boto3`，本機開發打 MinIO）                                                                                                         |
| 回寫 Job 狀態 | gRPC 呼叫 Upload Service 的 `InternalJobService.UpdateJobStatus`（不需要 x-user-id，服務對服務）                                                 |
| 快取          | Redis（`redis-py`）：`GetTranscript` 的 cache-aside，見下方「逐字稿快取」；連不上時照樣讀資料庫                                                    |

## 前置需求

- 先啟動基礎設施：`cd ../infra && docker compose up -d`（Postgres、RabbitMQ、MinIO、Redis；Redis 沒開時逐字稿快取略過，照樣讀資料庫）
- Upload Service 要跑在 `localhost:9090`（見 [`../upload-service`](../upload-service)），因為要呼叫它的 `InternalJobService.UpdateJobStatus`
- 語音辨識二選一：本地的（`../infra/scripts/vllm.sh up` 起的 `localhost:8002`，`.env` 填 `STT_BASE_URL`、`STT_MODEL`；本機跑時講者分離的模型要自己下載，見 `Dockerfile`，或設 `DIARIZATION_MODELS_DIR`），或一組 Deepgram API Key（[console.deepgram.com](https://console.deepgram.com)，新帳號送 $200 額度、不用綁卡），填進 `.env` 的 `DEEPGRAM_API_KEY`。都沒設時轉錄會說「語音辨識尚未設定」

```bash
cp .env.example .env   # 第一次使用才需要；預設指向 vllm.sh 起的本地語音辨識
uv sync
```

## 啟動服務

```bash
uv run python -m app.main
```

啟動時會：

1. 把 `transcription_db` 的 schema 升級到最新的 Alembic migration（多個副本同時啟動時用 Postgres advisory lock 排隊）。導入 Alembic 前用 `create_all` 建好表的資料庫（baseline 的兩張表都在、沒有 `alembic_version`）會先自動 stamp 成 baseline（`0001`）再升級，不需要刪庫重建；只有部分 baseline 表的資料庫會拒絕啟動並說明缺哪張表
2. 開一條背景 thread 消費 RabbitMQ 的 `transcription.requested`（主要業務入口，MQ 驅動）
3. 起 gRPC server，監聽 `8083`

## Pipeline

```
消費 transcription.requested { jobId, userId, storagePath, fileType, transcriptionLanguage }（語言：zh-TW / en / auto；舊訊息沒有，當成中文）
  → UpdateJobStatus(TRANSCRIBING)
  → 從物件儲存下載檔案
  → 用 ffmpeg 讀檔案的實際長度（不解碼），超過每個檔案的上限（`MAX_RECORDING_MINUTES`，60）、超過擁有者這個月剩下的轉錄分鐘數
    （`USAGE_LIMIT_TRANSCRIPTION_MINUTES`，600，跟 gateway 同一個值；台灣時間的月份）、或讀不出長度 → 不做語音辨識，直接走下面的 FAILED，
    原因寫給使用者看（`services/recording_limits.py`；上傳時的長度是前端量的，可以亂填）。影片在抽音軌之前就量
  → file_type == VIDEO 才用 moviepy 抽音軌，AUDIO 直接用原始檔案
  → 語音辨識：本地的是先分講者、每段送 vLLM，拿回片段的起訖時間與文字（講者是那一段的）；Deepgram 是音檔內容直接上傳（不傳 URL），拿回每個字的起訖時間、文字與講者
  → 記一筆轉錄用量（音檔秒數：Deepgram 回報的長度，本地的是解碼後的長度；廠商記成 `deepgram` 或 `local`；呼叫失敗也記一筆沒有秒數的失敗紀錄，存不進去只記 log）
  → 切成片段：換講者、句末標點、字間停頓 ≥ 0.5 秒時切，片段即將超過 15 秒時在字的邊界強制切
    （每個片段只屬於一位講者；中文字之間不加空白、英文字之間加一個）
  → 講者依第一次開口的順序換成這個 Job 的標籤 S1、S2…（預設名稱「講者 N」）
  → 語言是中文才轉成繁體（OpenCC s2tw，只換字形不換詞；其他語言原樣）
  → 逐字稿存進 transcripts / transcript_segments / speakers
  → UpdateJobStatus(TRANSCRIBED)
  → 發送 transcription.completed { jobId, userId }（userId 原樣往下傳，ai-service 把用量記在他名下）

語音辨識（Deepgram 或本地的 vLLM）遇到暫時性錯誤（429、5xx、逾時或連不上）且訊息還有重試預算 → 送進 TTL retry queue，過一段
時間後自動送回原 queue 重新處理整個 pipeline（訊息層級 requeue，最多 2 次、共 3 次嘗試，見下方
「已知限制 / 待辦」跟 `app/services/retry.py`）。

其他情況（永久性失敗、或重試預算已用盡）→ UpdateJobStatus(FAILED, error_reason=<例外訊息>) + 發送
job.failed { jobId, stage: "TRANSCRIBING", errorReason }，訊息照樣 ack（不 requeue）。
```

## gRPC API

不對外開放，純內部服務對服務呼叫（對應 [`architecture-design.md`](../architecture-design.md) 3.3，原本文件寫的是 REST，這裡改成跟平台其他服務一致的 gRPC）：

`TranscriptionService`（`transuai.transcription.v1`，見 [`../infra/proto/transcription.proto`](../infra/proto/transcription.proto)）：

| RPC             | 說明                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `GetTranscript` | 依 `job_id` 取得逐字稿全文 + 片段（id、timestamp、講者標籤、目前文字、原始文字）+ `revision` + 講者列表（標籤、顯示名稱、顯示順序；顯示名稱在這裡決定：自訂名稱，否則「講者 N」），`job_id` 不合法回 `INVALID_ARGUMENT`，找不到回 `NOT_FOUND` |
| `UpdateSegmentText` | 編輯一個片段的文字：去前後空白，空字串＝清空；跟目前相同則不動作；否則更新文字、`revision` +1、以未清空片段依換行重組全文，並發送 `transcript.edited { jobId }`（逐字稿那列 `SELECT … FOR UPDATE`，同時編輯以最後寫入為準但 revision 各加一次）。id 格式錯誤 / 超過 2,000 字回 `INVALID_ARGUMENT`，逐字稿或片段不存在、片段不屬於該 job 回 `NOT_FOUND` |
| `RenameSpeaker` | 替講者命名：去前後空白，空字串或等於預設名稱「講者 N」＝恢復預設名稱；顯示名稱沒變則不動作；否則更新、`revision` +1，並發送 `transcript.edited { jobId }`（同一把逐字稿列鎖）。`job_id` 格式錯誤 / 名稱超過 100 字回 `INVALID_ARGUMENT`，逐字稿或這個標籤的講者不存在回 `NOT_FOUND` |
| `AssignSegmentSpeaker` | 改片段的講者：目標是現有講者的標籤，或「新增講者」（可附名稱，排在顯示順序最後）。逐字稿還沒有任何講者（講者分離之前的舊 Job）時，新增講者前先把沒有講者的片段一起歸給新的講者 1，這樣指定出來就是兩位。片段本來就是目標講者則不動作；否則更新、`revision` +1，並發送 `transcript.edited { jobId }`，回傳片段、所有講者、`revision`。id 格式錯誤、沒有指定目標、名稱超過 100 字回 `INVALID_ARGUMENT`，逐字稿 / 片段 / 標籤不存在或片段不屬於該 job 回 `NOT_FOUND` |
| `ListJobTranscriptionUsage` | 列出一個 Job 的轉錄用量（依時間升冪）：廠商、模型、音檔秒數（沒回報就不設定，proto3 `optional`）、成功或失敗；`job_id` 不合法回 `INVALID_ARGUMENT`，沒有紀錄回空列表 |
| `SumUserTranscriptionUsage` | 一位使用者在 `[start, end)` 之間的轉錄用量，依廠商、模型加總：音檔秒數（已知秒數的加總）、呼叫次數（失敗也算）、沒回報秒數的次數；Gateway 把「某個月」換成時間範圍。`user_id` 不合法或沒給 `start` / `end` 回 `INVALID_ARGUMENT`，沒有用量回空列表 |

不需要 `x-user-id`，跟 upload-service 的 `InternalJobService` 一樣只信任內部網路呼叫。

### 逐字稿快取

`GetTranscript` 讀很多（問答的每一題、出題、會後處理、重新產生摘要、前端），只在編輯時才變，所以做 cache-aside（`app/services/transcript_cache.py`）：
Redis 的 `transcript:v1:{job_id}` 是一個 hash，存序列化的 `Transcript` 與它的 `revision`，有效 10 分鐘（`TRANSCRIPT_CACHE_TTL_SECONDS`）。
`v1` 是格式的版本：`Transcript` 的欄位變了就換版本，舊格式的快取不會被讀到。

- 讀：有內容就直接回；沒有才讀資料庫並寫回。找不到的逐字稿不記。
- 三種編輯（`UpdateSegmentText`、`RenameSpeaker`、`AssignSegmentSpeaker`）真的改了之後（已經寫進資料庫），記下最新的 `revision` 並丟掉內容；
  pipeline 存檔之後也是（訊息重送時會再存一次）。Job 刪掉時用 `forget`：丟掉內容，並擋住刪除之前就開始、晚一步寫回的讀取。
- 寫回只在自己讀到的 `revision` 不比記下的舊時才寫（Lua 原子地比較）：編輯之前就開始、晚一步寫回的讀取帶不回舊版，編輯後下一次讀到的一定是新版。
- Redis 連不上時照樣讀資料庫，只記 log，而且不重試（redis-py 預設重試 10 次，實測連不上時一次要 3.7 秒以上；逾時 0.5 秒）；編輯時
  連不上的話，舊內容最多留到有效時間結束。

對外連線只准連 `OUTBOUND_ALLOWED_HOSTS`（逗號分隔；空的就只有 `api.deepgram.com`，本地語音辨識伺服器（`STT_BASE_URL`）的網域自動加入，`app/core/outbound.py`，ASVS 12.6.1）：語音辨識的 client
送出前看網域，不在清單裡就不送、記 log（不算暫時性失敗、不重試）。物件儲存（boto3）是內部服務，不經過它。

轉錄上限的環境變數：`MAX_RECORDING_MINUTES`（`60`）、`USAGE_LIMIT_TRANSCRIPTION_MINUTES`（`600`，要跟 gateway 一樣；k8s 都在 `app-config`）。

環境變數：`REDIS_HOST`（`localhost`）、`REDIS_PORT`（`6379`）、`REDIS_PASSWORD`（空）、`REDIS_TIMEOUT_SECONDS`（`0.5`）、`TRANSCRIPT_CACHE_TTL_SECONDS`（`600`）。

### 測試方式

跟 upload-service 一樣，用 Postman 開 gRPC 分頁連 `localhost:8083`（plaintext，記得關閉 TLS），靠 reflection 自動列出 method；或用 grpcurl：

```bash
grpcurl -plaintext localhost:8083 list transuai.transcription.v1.TranscriptionService

grpcurl -plaintext -d '{"jobId":"<job_id>"}' \
  localhost:8083 transuai.transcription.v1.TranscriptionService/GetTranscript
```

## 資料庫 migration

新增或修改 model 之後，產生一支新的 migration、檢查內容，再重新啟動服務（啟動時自動升級）：

```bash
uv run alembic revision --autogenerate --rev-id 0004 -m "describe the change"   # 版本號接續上一支，檔名才會依序排
uv run alembic check   # models 跟 migration 沒有差異時會回 No new upgrade operations detected
```

自動接手判斷不適用時（例如手動修好了表結構），也可以直接手動標記某個資料庫目前的版本：

```bash
uv run alembic stamp 0001
```

`alembic.ini` 只給 CLI 用，資料庫連線一律來自 `app/core/config.py` 的設定（環境變數 / `.env`）。

## 測試

```bash
uv run pytest
```

用 pytest，mocking 只用標準庫的 `unittest.mock`。

gRPC 服務本身（`tests/test_transcript_grpc.py`：查詢與啟動 migration；`tests/test_segment_editing.py`：編輯片段；`tests/test_speaker_editing.py`：替講者命名、改片段的講者；
`tests/test_transcript_cache.py`：逐字稿快取；`tests/test_recording_limits.py` 的「這個月用了多少」）是對**真的 Postgres 與 Redis** 測：`tests/conftest.py` 用 Testcontainers 在測試開始時起用完即丟的
Postgres（`transcription_test_db`）與 Redis（隨機 port），跑完自動刪掉，不用先開 `infra` 的 docker compose（只要 Docker 有在跑），絕對不會碰到
`transcription_db`；用服務啟動時同一套 `init_db()` 跑 migration，再在 process 裡起一個真的 gRPC server 給測試呼叫（參考 upload-service 的 IT 做法）。

其餘 pipeline 測試不需要 API key（`tests/conftest.py` 一載入就起上面兩個容器，所以跑任何測試都要有 Docker）——`tests/conftest.py` 的 `mocks` fixture 把 pipeline 會碰到的所有外部 I/O（語音辨識、下載、
抽音軌、gRPC 狀態回報、DB session / 存檔）都 mock 掉，語音辨識直接回傳不綁定廠商的逐字資料，驗證 `process_message()` 這個 seam 本身的邏輯：
`tests/test_pipeline_segmentation.py` 驗證切片段與講者編號，`tests/test_pipeline_retry.py` 驗證重試分流，
`tests/test_pipeline_traditional_chinese.py` 驗證存進去的逐字稿有轉成繁體（以及非中文不轉、只換字形不換詞）；
`tests/test_retry.py` 直接測 retry queue 路由，不碰真正的 RabbitMQ/pika。

本地語音辨識另有 `tests/test_local_speech.py`（送去轉錄的段落怎麼切、送給 vLLM 的請求、時間與講者怎麼對回整段錄音、自動偵測語言、錯誤分類、沒設定時）。Deepgram 的廠商邊界：`tests/test_speech_recognition.py` 用 ADR 0001 實測時錄下的真實 Deepgram 回應
（`tests/fixtures/`）驗證解析結果與暫時性錯誤的判斷，HTTP 層用 httpx 的 `MockTransport`。

Mock 一定要 patch 在 `app/services/pipeline.py`「使用端」import 進來的名稱（例如
`pipeline.recognize`、`pipeline.job_status_client`），不是「定義端」的原始模組——`unittest.mock.patch`
只替換掉 name binding，patch 定義端不會影響 pipeline.py 實際呼叫到的是誰（跟 `ai-service` 同一個
坑，見 `ai-service/README.md` 測試一節）。

## 重新產生 gRPC stub

兩份 proto 都要編，都在 `../infra/proto`：`upload.proto`（呼叫 upload-service 的 `InternalJobService`）跟 `transcription.proto`（這個 repo 自己的 API 規格）：

```bash
./scripts/generate_grpc.sh
```

產物在 `app/proto_gen/`，有 commit 進版控，不用每個環境都拉 upload-service repo 才能跑。

## 專案結構

MVC 風格分層，對照方式：`models` = Model，`controllers` = Controller（這裡是 gRPC servicer，不是 REST route），業務邏輯（pipeline、外部服務呼叫）另外拆到 `services`，DB 存取拆到 `repositories`——這兩層是常見的延伸，純 MVC 沒有明確對應位置。gRPC 用 proto message 本身當輸入/輸出格式，不需要另外的 `schemas` 序列化層。

```
app/
  main.py                       建立 gRPC server（TranscriptionService + health + reflection）、lifespan（起 consumer thread、init_db）
  core/
    config.py                    pydantic-settings，讀 .env
  models/
    transcript.py                 Transcript / TranscriptSegment / Speaker（SQLAlchemy ORM）
  controllers/
    transcript_controller.py       TranscriptionServiceServicer 實作（GetTranscript、UpdateSegmentText、RenameSpeaker、AssignSegmentSpeaker）
  services/
    consumer.py                      RabbitMQ consumer loop（pika）
    deletion_consumer.py             刪除事件（job.deleted、account.deleted）：各自的佇列、retry 佇列，另一條 thread
    account_deletion.py              刪除帳號：用量去識別化
    job_deletion.py                  刪掉一個 Job 的逐字稿與快取；deleted_jobs 標記與寫入後的檢查
    pipeline.py                       單一訊息的處理流程（見上面 Pipeline 一節）
    storage.py                         從 MinIO/R2 下載檔案
    audio.py                            moviepy 抽音軌
    speech_recognition.py                語音辨識 adapter：依設定選本地或 Deepgram（都沒有就 RecognitionNotConfigured），回傳不綁定廠商的逐字資料與音檔秒數，並判斷錯誤是否暫時性
    local_speech.py                      本地語音辨識：解碼成 16kHz、分講者、切成每段最長 30 秒、送 vLLM 的 /v1/audio/transcriptions、把時間對回整段錄音
    diarization.py                       講者分離（sherpa-onnx，CPU；模型在 DIARIZATION_MODELS_DIR，沒有就不分）
    transcription_usage.py               記錄轉錄用量（Job 擁有者、音檔秒數、成功或失敗），存檔失敗只記 log
    segmentation.py                       把逐字資料切成片段、講者依第一次開口的順序編號（跟廠商無關）
    transcript_result.py                  切好片段、準備存檔的逐字稿（dataclass）
    traditional_chinese.py                中文逐字稿轉繁體（OpenCC s2tw），pipeline 在切片段與存檔之間呼叫
    job_status_client.py                  gRPC client，呼叫 Upload Service 的 UpdateJobStatus
    event_publisher.py                     發送 transcription.completed / job.failed（pipeline 用，走 consumer 的連線）
    transcript_cache.py                    逐字稿的 cache-aside（Redis，帶 revision；見「逐字稿快取」）
    edit_events.py                         編輯後發送 transcript.edited { jobId }：gRPC handler 自己開短連線，失敗做 3 次小型重試，仍失敗記 TRANSCRIPTION_SERVICE_TRANSCRIPT_EDITED_EVENT_LOST 但編輯照樣成功
  repositories/
    transcript_repository.py               transcription_db 存取（transcripts / transcript_segments / speakers）
    transcription_usage_repository.py       transcription_db 存取（transcription_usage），每筆用自己的 session 立即寫入
  db/
    session.py                               engine / session / init_db（Alembic upgrade，含接手舊 create_all 資料庫）
    migrations/                              Alembic migration（`0001_baseline` 是導入前 create_all 建出的 schema；`0002_segment_editing` 加 `original_text`、`revision`；`0003_speakers` 加 `speakers` 表；`0004_transcription_usage` 加轉錄用量表）
  proto_gen/                                  gRPC stub 產物（由 scripts/generate_grpc.sh 產生）
scripts/generate_grpc.sh                    重新產生 gRPC stub
```

## 刪除 Job（`job.deleted`）

upload-service 刪掉一個 Job 後發 `job.deleted { jobId, userId }` 到 fanout exchange `job.deleted`；這個服務綁 `job.deleted.transcription`
（`app/services/deletion_consumer.py`，另一條 thread、另一條連線，不排在轉錄後面），清掉這個 Job 的逐字稿（片段、講者跟著 cascade）與逐字稿快取。
**轉錄用量不刪**（月用量不能因為刪 Job 變少）。可以重複處理；處理失敗（例如資料庫連不上）nack 到 `job.deleted.transcription.retry`，30 秒後回來，
不限次數；訊息本身不合法才丟掉。見 `docs/adr/0005-deletion-events-fan-out-through-an-outbox.md`。

刪除當下還在轉錄（或在編輯）的話，存檔可能比刪除晚：收到事件時先記下 `deleted_jobs`（保留一天）再刪資料，pipeline 存檔與三種編輯在 commit
**之後**查它（`job_deletion.discard_if_deleted`），有就把剛寫的刪掉——pipeline 就此停下、不回報狀態也不發 `transcription.completed`，編輯回
`NOT_FOUND`。

刪除帳號：auth-service 發 `account.deleted { userId }`（fanout exchange `account.deleted`），這個服務綁 `account.deleted.transcription`（同一個
`deletion_consumer`），把他的轉錄用量**去識別化**（`user_id` 設成 NULL，`app/services/account_deletion.py`）；他的逐字稿由每個 Job 的
`job.deleted` 清。

## 正式環境（`APP_ENV=production`）

`APP_ENV` 預設是 `development`；設成 `production`時：

- 啟動前檢查密鑰（`app/core/production.py`）：`DB_PASSWORD`、`RABBITMQ_PASSWORD`、`STORAGE_SECRET_KEY`、`REDIS_PASSWORD`、`DEEPGRAM_API_KEY`（有設本地語音辨識 `STT_BASE_URL`＋`STT_MODEL` 時不需要）沒設、還是開發用的預設值（`0000`、`admin`、`dev-only-…` 這類，跟 `infra/k8s/02-secret.yaml` 一致）、
  或少於 12 字元，就不啟動，錯誤訊息列出是哪幾個環境變數。
- gRPC reflection 關掉（`app/main.py` 的 `build_server`）。

開發環境都不檢查、照舊開著。見 `.scratch/pre-launch-hardening/issues/07`。

## 依賴套件弱點掃描

掃的是正式執行時會裝的依賴（跟 Dockerfile 的 `uv sync --no-dev` 一樣，不含 pytest 這類開發工具），用 [pip-audit](https://pypi.org/project/pip-audit/)
對照 PyPI／OSV 的弱點資料庫：

```bash
uv export --frozen --no-dev --no-hashes --no-emit-project --format requirements-txt > /tmp/requirements.txt
uvx pip-audit --no-deps --disable-pip -r /tmp/requirements.txt
```

上線前、以及之後每個月或升級依賴時跑一次。高風險、嚴重的要升級，或在這裡寫清楚為什麼不影響。

最近一次結果：2026-10-03：沒有已知弱點。原本 pillow 11.3.0 有多個高風險弱點（PSD／FITS／PDF／字型等格式的解析），urllib3 2.7.0 也有；urllib3 升到 2.8.0。pillow 是 moviepy 帶進來的，moviepy 2.2.1（目前最新）把它限制在 <12，所以在 `pyproject.toml` 的 `[tool.uv]` 用 `override-dependencies` 覆蓋成 12.3.0。這個服務只用 moviepy 的 `VideoFileClip` 抽音軌，影片由 ffmpeg 解碼、不經過 Pillow，原本那些弱點本來就碰不到；覆蓋之後 `tests/test_audio_extraction.py` 實際抽一次音軌確認照樣能跑。moviepy 放寬限制之後拿掉覆蓋。

## 已知限制 / 待辦

- `recognize()` 呼叫 Deepgram 或本地的 vLLM 遇到暫時性錯誤（429、5xx、逾時、連不上）會自動重試（訊息層級 requeue，最多 2 次、共 3 次嘗試，機制跟 `ai-service` 完全一樣，見 `app/services/retry.py` 跟 `ai-service/docs/adr/0001-...md`）；永久性失敗（壞檔、認證失敗、額度用完的 402 等）或重試預算用盡才會直接判定 `FAILED`，要重新上傳才能重跑。`download_object`/`extract_audio_track`/DB 寫入/gRPC 狀態回報這幾步目前還不在這個重試機制涵蓋範圍內，任一步失敗一樣立即判定失敗（這點跟 RabbitMQ **連線**層級不一樣：consumer 連線斷線時已經有指數退避自動重連，見 `app/services/consumer.py`）
- 若 `UpdateJobStatus(FAILED, ...)` 這個回寫本身也失敗（例如 job 在 upload-service 那邊已經不存在），現在會被接住只記 log，不會再讓 consumer thread 掛掉；但這則訊息就此沒有任何後續動作（不會重試、不會有 `job.failed` 事件），只能從 log 找出來手動處理——`ai-service` 已經幫這一段補上獨立的 in-process 重試 + 高嚴重度 log marker，這裡還沒跟進，是目前真實存在的已知限制
- 講者分離只在新轉錄的 Job 上做，舊 Job 不回填（沒有講者，當成只有一位講者）。自動分離不完美：Deepgram 很短的插話（「對」「真的」）常被併進前一位講者，三人以上的對話偶爾只分出兩位（見 ADR 0001 的實測）；本地的同一個人可能被拆成兩位、分出幾個人很受 `DIARIZATION_THRESHOLD` 影響（見 ADR 0003 的實測）
- 本地語音辨識只有片段（不是每個字）的時間，片段最長近 30 秒；比 Deepgram 慢很多（約 3 倍速，一小時的錄音約 20 分鐘），vLLM 一次只處理一段是瓶頸；Whisper 系的模型偶爾會在很短或很吵的段落聽出不存在的字
- 語言由上傳時選（ADR 0002）：中文（`zh-TW`，預設，也是沒帶語言時的 `DEEPGRAM_LANGUAGE`）、英文（`en`）、自動偵測（`detect_language=zh&detect_language=en`）。自動偵測判斷成中文時走通用中文模型，錯字明顯較多（ADR 0001 的實測），所以不是預設；整個檔案只判斷一種語言，中英夾雜的錄音仍然辨識不好。語言選錯要重新上傳
- Deepgram 的 $200 是一次性額度，用完就要付費（$0.0043/分鐘），不像 Groq 每天重置；額度監控與告警仍然沒有（`architecture-design.md` 第 7 節第 7 點）
- 中文轉錄幾乎沒有標點，片段主要靠停頓切開；`smart_format` 偶爾把中文裡的數字和英文切碎（例如「200 3年」），照原樣保留
- 繁體轉換只套用在新轉錄的 Job，這個功能上線前存進去的簡體逐字稿不回填
- 測試涵蓋 pipeline seam（切片段、講者編號、重試分流、繁體轉換）、語音辨識 adapter 的回應解析與錯誤分類、retry queue 路由、gRPC 服務（查詢、編輯、啟動 migration，對真的 Postgres）；`storage`/`audio` 等跟外部服務打交道的模組本身還只靠手動 smoke test（語音辨識 adapter 有用錄下的真實回應測解析）
