import asyncio
import logging
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from app.controllers.ws_controller import router as ws_router
from app.core.config import settings
from app.services.consumer import run_consumer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    loop = asyncio.get_running_loop()
    consumer_thread = threading.Thread(
        target=run_consumer, args=(loop,), name="notification-consumer", daemon=True)
    consumer_thread.start()
    logger.info("started RabbitMQ consumer thread")
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(ws_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def serve() -> None:
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port)


if __name__ == "__main__":
    serve()
