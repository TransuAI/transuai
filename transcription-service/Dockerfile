# app/proto_gen 是預先產生好、已 commit 進版控的 protoc 產物（見 scripts/generate_grpc.sh），
# 這裡不需要 infra/proto，build context 就是這個 repo 自己：
#   docker build -t transuai/transcription-service:dev .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

# moviepy 底層用 imageio-ffmpeg，第一次執行時會下載 ffmpeg binary 到 cache（需要 outbound
# 網路 + 可寫檔案系統），不是 image build 期間就打包好。
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8083
CMD ["python", "-m", "app.main"]
