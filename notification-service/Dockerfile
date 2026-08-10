# 純 FastAPI + pika，不涉及 gRPC/proto，build context 就是這個 repo 自己：
#   docker build -t transuai/notification-service:dev .
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8085
CMD ["python", "-m", "app.main"]
