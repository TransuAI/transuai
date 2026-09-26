"""自有金鑰與已連結帳號權杖的加密（AES-256-GCM）。主金鑰來自設定（`KEY_ENCRYPTION_KEY`，base64 的 32 bytes），不在
資料庫裡：資料庫外洩時，拿到的只有密文。"""

import base64
import binascii
import os
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

_NONCE_BYTES = 12


class EncryptionUnavailable(Exception):
    """伺服器沒有設定（或設定了無效的）主金鑰。"""


def _cipher() -> AESGCM:
    try:
        key = base64.b64decode(settings.key_encryption_key, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise EncryptionUnavailable("KEY_ENCRYPTION_KEY is not valid base64") from exc
    if len(key) != 32:
        raise EncryptionUnavailable("KEY_ENCRYPTION_KEY must be 32 bytes (base64-encoded)")
    return AESGCM(key)


def encrypt(plaintext: str, *, bound_to: str) -> bytes:
    """回傳 nonce + 密文（含驗證標籤）。每次都用新的隨機 nonce。`bound_to`（例如「使用者:廠商」）當成附加驗證資料：
    密文被搬到別的使用者或廠商名下時會解不開，能改資料庫的人也沒辦法把一把金鑰挪給別人用。"""
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + _cipher().encrypt(nonce, plaintext.encode("utf-8"), bound_to.encode("utf-8"))


def decrypt(ciphertext: bytes, *, bound_to: str) -> str:
    return _cipher().decrypt(
        ciphertext[:_NONCE_BYTES], ciphertext[_NONCE_BYTES:], bound_to.encode("utf-8")).decode("utf-8")


def key_binding(user_id: uuid.UUID, owner: str) -> str:
    """密文綁定的對象：哪位使用者的什麼（自有金鑰是廠商，例如「openai」；已連結帳號的權杖是「connection:google:access」）。"""
    return f"{user_id}:{owner}"


def ensure_available() -> None:
    """主金鑰沒設定或無效時 raise EncryptionUnavailable——在開始一件之後才要加密的事之前先確認。"""
    _cipher()
