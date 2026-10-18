# ADR 0003: 語音辨識可以完全跑在地端：自架 vLLM 的 Breeze-ASR-25，講者分離在 CPU 上用 sherpa-onnx

## Status

Accepted（2026-10-18）。Deepgram（ADR 0001）保留成可選的雲端方案。

## Context

- 系統要開源、讓客戶裝在自己內部的伺服器上；內部的錄音常常不能送出內網，語音辨識是最後一個一定要連外的部分（Deepgram）。
- ai-service 的模型已經跑在自架的 vLLM（ai-service ADR 0015）；同一支 `infra/scripts/vllm.sh` 已經起了 `MediaTek-Research/Breeze-ASR-25`
  （Whisper-large-v2 針對台灣華語與中英夾雜調過，Apache-2.0），OpenAI 相容的 `/v1/audio/transcriptions`，回傳**片段**的起訖時間——
  Whisper 系的模型在 vLLM 上沒有逐字時間。
- vLLM 不做講者分離。候選：
  - **pyannote**（community-1）：品質最好，但模型要在 Hugging Face 登入、同意條款、用金鑰下載，而且要裝 PyTorch（image 大很多）。
  - **sherpa-onnx**：用 ONNX 跑 pyannote 的 segmentation-3.0（MIT）切出說話的片段，加上 3D-Speaker 的 CAM++ 中文講者向量
    （Apache-2.0）分群；Python 套件小、模型從 GitHub release 直接下載（約 35MB），可以在 build 時打包進 image，執行時完全不用連網。

## Decision

- **跑在哪裡是設定**：`STT_BASE_URL`＋`STT_MODEL` 有設定就用本地；沒有就用 Deepgram（`DEEPGRAM_API_KEY`）；都沒有就 raise
  `RecognitionNotConfigured`（不重試，Job 失敗並說「語音辨識尚未設定」）。出廠都不設。正式環境的啟動檢查改成「本地或 Deepgram 至少一個」。
- **先分講者、再轉錄**（`local_speech.py`）：音檔用 ffmpeg（imageio-ffmpeg 附的）解成 16kHz 單聲道；sherpa-onnx 在 CPU 上分出誰在
  什麼時候說話；同一個人隔不到 1 秒的話併成一段、每段最長 30 秒（Whisper 一次看的長度）、兩人同時說話的部分只轉錄一次、短於 0.5 秒
  的不送；每段送給 vLLM（同時最多 4 個請求，伺服器自己排隊），回傳的片段時間加回這段在整段錄音裡的位置、標上這段的講者。只給片段
  時間的模型，一個片段常常跨好幾個人；先分講者，文字就不會掛錯人。結果照舊交給 `segmentation.build_transcript` 切片段、
  `to_traditional_if_chinese` 轉繁體。
- 語言：上傳時選的中文對 Whisper 是 `zh`、英文 `en`、自動偵測不指定（多數段落聽到的語言勝出）。
- 講者分離的模型由 Dockerfile 下載進 image（`/app/models/diarization`）；沒有模型時不分講者，整段每 30 秒送一次。
- 分群的門檻 `DIARIZATION_THRESHOLD` 預設 0.6（越大分出越少人），執行緒數 `DIARIZATION_THREADS` 預設 4。
- **講者分離在另一個 process 跑**（2026-10-18 補）：sherpa-onnx 處理時一直拿著 Python 的 GIL，一小時的錄音要 7 分鐘左右，在服務的 process
  裡跑的話 gRPC（看逐字稿）與 RabbitMQ 的其他連線全部停住（心跳斷線、訊息重新投遞、整個檔案從頭再來）。子 process（spawn）自己讀檔、
  解碼、分講者，只傳回每段誰在說話，做完就結束，記憶體（解碼的音訊約 230MB＋模型）跟著還回去。
- **一段失敗不拖垮整個檔案**：一段遇到連不上、逾時、429、500 以外的 5xx 時，那一段自己重試（2 秒、5 秒後，共 3 次）；vLLM 在幾乎沒有
  辨識結果的段落算片段時間會回 500（v0.31 的 bug），那段改成只要文字、整段當一個片段。

## 實測（RTX 5080 上的 vLLM、kind 叢集裡的 transcription-service，2026-10-18）

- 3 分鐘的中文節目（新聞片段剪輯開場）：講者分離 19 秒（CPU）、17 段轉錄 37 秒，**共 57 秒（約 3 倍速）**；文字正確、轉成繁體，
  之後的摘要、標題、章節照常。一小時的錄音約 20 分鐘（Deepgram 約 1 分鐘）。
- 90 秒的英文會議：講者分離 9 秒，全部 23 秒。
- 門檻對分出幾個人影響很大：同一段 3 分鐘的中文是 12（0.5）／9（0.6）／8（0.7）／6（0.8）人；英文會議 0.5 會把同一個人拆成兩個、
  0.6 起是 3 人。沒有標準答案可以對，先取 0.6。

## Consequences

- 不用任何雲端服務也能完整轉錄；Deepgram 的金鑰不再是必要的。
- 比 Deepgram 慢很多（約 3 倍速 vs. 幾十倍速），一小時的錄音要等約 20 分鐘；vLLM 的語音辨識一次只處理一段（16GB 的卡放不下更多，
  見 ai-service ADR 0015），是主要的瓶頸。卡比較大時可以提高 `vllm.sh` 的 `--max-num-seqs`。
- 講者分離不完美：同一個人可能被拆成兩位、聲音像的人可能被合在一起；使用者可以在逐字稿上改講者（ADR 之前的「改講者」功能）。
- 只有片段的時間（不是每個字）：片段最長可能接近 30 秒，比 Deepgram 逐字切出來的片段粗。
- Whisper 系的模型偶爾會在很短或很吵的段落「聽出」不存在的字；短於 0.5 秒的段落不送，可以減少但不能消除。
- image 多了 sherpa-onnx（約 30MB）與模型（約 35MB）；build 時要能連到 GitHub。
