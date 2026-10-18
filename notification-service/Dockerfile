# app/proto_gen 是預先產生好、已 commit 進版控的 protoc 產物，這裡不需要 infra/proto，build context 就是這個 repo 自己：
#   docker build -t transuai/notification-service:dev .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
# 容器裡要聽所有介面，別的容器（frontend 的 nginx）才連得到；沒設時只聽本機（app/core/config.py 的 http_host）。
ENV HTTP_HOST=0.0.0.0
EXPOSE 8085
CMD ["python", "-m", "app.main"]
