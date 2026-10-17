import asyncio
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.services.access_token import InvalidAccessToken, user_id_from
from app.services.connection_limits import ConnectionLimits, connection_limits
from app.services.connection_manager import connection_manager
from app.services.job_access import JobAccess, JobAccessUnavailable, job_access

logger = logging.getLogger(__name__)

router = APIRouter()

# 關閉連線的代碼（4000–4999 是給應用程式自己用的），前端依這個決定要不要重連（見 frontend 的 use-job-socket）。
CLOSE_UNAUTHORIZED = 4401  # 沒在時限內送 access token，或 token 不能用：前端換發 token 後再連
CLOSE_JOB_NOT_FOUND = 4404  # 不是這位使用者的 Job（或不存在）：跟 gateway 一樣不透露是哪一種，前端不再重連
CLOSE_TOO_MANY_CONNECTIONS = 4429  # 超過同時連線數上限：前端隔久一點再連
CLOSE_TRY_AGAIN_LATER = 1011  # 問不到 upload-service：前端照常重連


def get_job_access() -> JobAccess:
    return job_access


def get_connection_limits() -> ConnectionLimits:
    return connection_limits


@router.websocket("/ws/jobs/{job_id}")
async def subscribe_job(
    websocket: WebSocket,
    job_id: str,
    access: JobAccess = Depends(get_job_access),
    limits: ConnectionLimits = Depends(get_connection_limits),
) -> None:
    """對應 ../architecture-design.md 3.5：訂閱單一 Job 的狀態更新事件。

    瀏覽器的 WebSocket 不能帶 Authorization 標頭，access token 也不放網址（會留在存取紀錄裡），所以連上之後第一則訊息要是
    {"type": "auth", "accessToken": "..."}；驗證通過、Job 是這位使用者的，才回 {"type": "subscribed"} 並開始推播。
    """
    address = websocket.client.host if websocket.client else "unknown"
    await websocket.accept()
    if not limits.take_address(address):
        await websocket.close(code=CLOSE_TOO_MANY_CONNECTIONS, reason="too many connections")
        return
    try:
        await _subscribe(websocket, job_id, access, limits)
    except WebSocketDisconnect:
        pass
    finally:
        limits.release_address(address)


async def _subscribe(websocket: WebSocket, job_id: str, access: JobAccess, limits: ConnectionLimits) -> None:
    user_id = await _authenticate(websocket)
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="unauthorized")
        return
    if not limits.take_user(user_id):
        await websocket.close(code=CLOSE_TOO_MANY_CONNECTIONS, reason="too many connections")
        return
    try:
        try:
            owns = await access.owns(user_id, job_id)
        except JobAccessUnavailable:
            await websocket.close(code=CLOSE_TRY_AGAIN_LATER, reason="try again later")
            return
        if not owns:
            await websocket.close(code=CLOSE_JOB_NOT_FOUND, reason="job not found")
            return
        await _push_until_disconnected(websocket, job_id)
    finally:
        limits.release_user(user_id)


async def _authenticate(websocket: WebSocket) -> str | None:
    """等第一則訊息裡的 access token，回傳使用者 id；超過時限、格式不對或 token 不能用都是 None。"""
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=settings.ws_auth_timeout_seconds)
    except (TimeoutError, KeyError):  # KeyError：送的是二進位訊息
        return None
    try:
        message = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(message, dict) or message.get("type") != "auth" or not isinstance(message.get("accessToken"), str):
        return None
    try:
        return user_id_from(message["accessToken"], settings.jwt_secret)
    except InvalidAccessToken:
        return None


async def _push_until_disconnected(websocket: WebSocket, job_id: str) -> None:
    await connection_manager.connect(job_id, websocket)
    logger.info("client subscribed to job %s", job_id)
    try:
        await websocket.send_json({"type": "subscribed", "jobId": job_id})
        while True:
            # 之後這條連線只用來單向推播，不處理 client 傳來的內容；receive_text() 純粹用來偵測連線是否已斷開。
            await websocket.receive_text()
    finally:
        await connection_manager.disconnect(job_id, websocket)
        logger.info("client unsubscribed from job %s", job_id)
