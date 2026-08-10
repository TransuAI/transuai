import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.connection_manager import connection_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/jobs/{job_id}")
async def subscribe_job(websocket: WebSocket, job_id: str) -> None:
    """對應 ../architecture-design.md 3.5：訂閱單一 Job 的狀態更新事件。"""
    await connection_manager.connect(job_id, websocket)
    logger.info("client subscribed to job %s", job_id)
    try:
        while True:
            # 這條連線只用來單向推播，不處理 client 傳來的內容；
            # receive_text() 純粹用來偵測連線是否已斷開。
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await connection_manager.disconnect(job_id, websocket)
        logger.info("client unsubscribed from job %s", job_id)
