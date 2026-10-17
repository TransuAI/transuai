"""系統設定頁存的金鑰的加密（AES-256-GCM），跟 ai-service 的 key_encryption 同一套：主金鑰來自 `KEY_ENCRYPTION_KEY`（base64 的
32 bytes），不在資料庫裡。`bound_to` 當成附加驗證資料，密文搬到別的欄位就解不開。"""

import base64
import binascii
import os

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
    nonce = os.urandom(_NONCE_BYTES)
    return nonce + _cipher().encrypt(nonce, plaintext.encode("utf-8"), bound_to.encode("utf-8"))


def decrypt(ciphertext: bytes, *, bound_to: str) -> str:
    return _cipher().decrypt(
        ciphertext[:_NONCE_BYTES], ciphertext[_NONCE_BYTES:], bound_to.encode("utf-8")).decode("utf-8")
