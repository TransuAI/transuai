# app/proto_gen 是預先產生好、已 commit 進版控的 protoc 產物（見 scripts/generate_grpc.sh），
# 這裡不需要 infra/proto，build context 就是這個 repo 自己：
#   docker build -t transuai/transcription-service:dev .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# 講者分離的模型（本地語音辨識用，見 docs/adr/0003）：build 時下載進 image，執行時不用連網（客戶內部的伺服器可能完全不能連外）。
# pyannote segmentation-3.0 的 ONNX（MIT）與 3D-Speaker 的 CAM++ 中文講者向量（Apache-2.0），都從 sherpa-onnx 的 GitHub release。
RUN python - <<'PY'
import tarfile, urllib.request
from pathlib import Path
models = Path("/app/models/diarization")
models.mkdir(parents=True, exist_ok=True)
base = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
archive, _ = urllib.request.urlretrieve(f"{base}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2")
with tarfile.open(archive) as tar:
    tar.extractall(models, filter="data")
urllib.request.urlretrieve(f"{base}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx",
                           models / "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx")
PY

COPY app ./app

# moviepy 與本地語音辨識的解碼都用 imageio-ffmpeg：它的 wheel 已經附了 ffmpeg 執行檔，不用另外下載。
ENV PATH="/app/.venv/bin:$PATH"
# glibc 預設每條 thread 一塊記憶體區（arena），用完不太還給系統；語音辨識同時開幾條 thread，限制成 2 塊，閒著時佔得少
#（8GB 的伺服器，見 infra/deploy/compose.yaml）。
ENV MALLOC_ARENA_MAX=2
EXPOSE 8083
CMD ["python", "-m", "app.main"]
