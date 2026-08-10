import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """依 job_id 分組管理目前連線的 WebSocket client，供 consumer 收到 MQ 事件時廣播推播。"""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, job_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(job_id, set()).add(websocket)

    async def disconnect(self, job_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(job_id)
            if connections is None:
                return
            connections.discard(websocket)
            if not connections:
                del self._connections[job_id]

    async def broadcast(self, job_id: str, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections.get(job_id, ()))
        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:
                logger.exception("failed to push to a client for job %s, dropping connection", job_id)
                await self.disconnect(job_id, websocket)


connection_manager = ConnectionManager()
