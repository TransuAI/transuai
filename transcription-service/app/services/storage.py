import logging
import os
import tempfile
from pathlib import Path

import boto3
from botocore.client import Config

from app.core.config import settings

logger = logging.getLogger(__name__)

_s3_client = boto3.client(
    "s3",
    endpoint_url=settings.storage_endpoint,
    aws_access_key_id=settings.storage_access_key,
    aws_secret_access_key=settings.storage_secret_key,
    region_name=settings.storage_region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)


def download_object(storage_path: str) -> Path:
    """把物件儲存裡的檔案下載到本機暫存檔，回傳暫存檔路徑（呼叫端負責之後刪除）。"""
    suffix = Path(storage_path).suffix
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    tmp = Path(tmp_path)

    logger.info("downloading %s from bucket %s",
                storage_path, settings.storage_bucket)
    _s3_client.download_file(settings.storage_bucket, storage_path, str(tmp))
    return tmp
