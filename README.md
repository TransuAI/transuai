# TransuAI

上傳會議、課程的錄音或影片，產生有講者的逐字稿、摘要、章節、決策與待辦，並且可以針對內容問答。為了裝在單位內部的伺服器上而設計：
語音辨識、摘要與問答的模型可以是單位自己的 GPU 伺服器（vLLM 等 OpenAI 相容的伺服器），完全不用連外；講者分離在 TransuAI 裡用 CPU 跑。
也可以接 Claude、OpenAI、Gemini、OpenRouter。

## 安裝

一台有 Docker 的 Linux 伺服器：

```bash
git clone <這個 repo> transuai
cd transuai/infra/deploy
./install.sh
```

安裝完會印出網址與管理員的帳號、初始密碼（第一次登入要換成自己的密碼）。模型伺服器另外部署（見
[infra/deploy/docs/models.md](infra/deploy/docs/models.md)），在「系統設定」填網址，寄信也在那裡設定。詳細的步驟、硬體建議、備份、升級、憑證與
離線安裝見 [infra/deploy/README.md](infra/deploy/README.md)。

## 開發

| 目錄 | 內容 |
| --- | --- |
| [frontend](frontend/) | 網頁（React、Vite） |
| [gateway](gateway/) | 對外的 REST API（Spring Boot） |
| [auth-service](auth-service/) | 帳號、登入、管理員、寄信 |
| [upload-service](upload-service/) | 上傳、檔案列表 |
| [transcription-service](transcription-service/) | 語音辨識、講者分離、逐字稿 |
| [ai-service](ai-service/) | 摘要、章節、問答、會後處理 |
| [notification-service](notification-service/) | 處理進度的 WebSocket |
| [infra](infra/) | proto、本機開發環境（docker-compose、kind）、安裝包 |

本機開發環境見 [infra/README.md](infra/README.md)；架構見 [infra/architecture-design.md](infra/architecture-design.md)。

### Monorepo 的慣例

- 每個服務一個目錄，各自的 Dockerfile、相依套件（`uv.lock`、Gradle、`package-lock.json`）與 README；共用的只有 `infra/proto`。
- 改 `infra/proto` 時只加欄位、不改也不重用編號；Python 服務的 `app/proto_gen` 要在同一個 commit 重新產生（各自的
  `scripts/generate_grpc.sh`），Java 服務 build 時自己產生。
- Commit 訊息：`<type>(<scope>): <subject>`，scope 是服務或領域；跨服務的改動放在同一個 commit。
- 程式與文件一起改（服務的 README、`infra/architecture-design.md`）。

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml)：每個 PR 與推到 `main` 時，只跑這次改到的服務——Java 服務 `./gradlew test`、Python 服務先確認
`app/proto_gen` 跟 `infra/proto` 一致再 `pytest`、前端 lint／build／測試、安裝包的 shell 與 compose 檢查。改了 `infra/proto` 的話用到它的服務都跑。
測試用 Testcontainers（GitHub 的 runner 有 Docker）。分支保護把 `ci-ok` 設成必要的檢查。

**程式碼掃描（SonarQube Cloud）**：monorepo，每個服務一個專案（`TransuAI_transuai-<服務>`，設定在各服務的 `sonar-project.properties`）。
CI 的測試同時產生覆蓋率報告（Java：JaCoCo；Python：pytest-cov；前端：vitest 的 v8 coverage），測完就掃那個服務。repo 的
Actions secret `SONAR_TOKEN` 沒設、或是從 fork 發的 PR（拿不到 secret）時跳過掃描，不讓 CI 失敗。SonarQube Cloud 那邊要關掉
Automatic Analysis（跟 CI 掃描只能擇一）。發行：推 `v*` 的 tag
（[`release-images.yml`](.github/workflows/release-images.yml)）。

## 授權

TransuAI 以 [Apache License 2.0](LICENSE) 授權。

安裝包另外用到的元件各有自己的授權（都是原樣使用，沒有修改）：MinIO（`pgsty/minio`，AGPL-3.0，獨立的容器）、PostgreSQL＋pgvector、
Redis、RabbitMQ、nginx、vLLM（Apache-2.0）；預設的模型 Qwen3-8B-AWQ、Qwen3-Embedding-0.6B、Breeze-ASR-25（Apache-2.0），
講者分離的 pyannote segmentation-3.0（MIT）與 3D-Speaker CAM++（Apache-2.0）。
