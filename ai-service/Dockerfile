# app/proto_gen 是預先產生好、已 commit 進版控的 protoc 產物，這裡不需要 infra/proto，
# build context 就是這個 repo 自己：
#   docker build -t transuai/ai-service:dev .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8084
CMD ["python", "-m", "app.main"]
