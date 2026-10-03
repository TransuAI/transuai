from collections import Counter

from app.core.config import settings


class ConnectionLimits:
    """同時連線數上限：每個來源 IP（連上就算，包括還沒驗證的）、每位使用者（驗證通過後算）。

    計數在記憶體裡、只在 uvicorn 的 event loop 上改（檢查與加一之間沒有 await），不用鎖；多副本部署時每個副本各算各的
    （見 README 已知限制）。take_* 成功的，連線結束時一定要 release_* 一次。
    """

    def __init__(self, per_user: int, per_address: int) -> None:
        self._per_user = per_user
        self._per_address = per_address
        self._users: Counter[str] = Counter()
        self._addresses: Counter[str] = Counter()

    def take_address(self, address: str) -> bool:
        return _take(self._addresses, address, self._per_address)

    def release_address(self, address: str) -> None:
        _release(self._addresses, address)

    def take_user(self, user_id: str) -> bool:
        return _take(self._users, user_id, self._per_user)

    def release_user(self, user_id: str) -> None:
        _release(self._users, user_id)


def _take(counts: Counter[str], key: str, limit: int) -> bool:
    if counts[key] >= limit:
        return False
    counts[key] += 1
    return True


def _release(counts: Counter[str], key: str) -> None:
    counts[key] -= 1
    if counts[key] <= 0:
        del counts[key]


connection_limits = ConnectionLimits(settings.ws_max_connections_per_user, settings.ws_max_connections_per_address)
