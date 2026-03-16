"""S3 storage helper utilities.

Provides a thin wrapper around boto3 for uploading files to the configured
S3 bucket. Consumers should call `upload_file(local_path, key)` which will
return an `s3://bucket/key` URI on success.
"""
from pathlib import Path
import logging
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_s3_client():
    """Return a boto3 S3 client using explicit settings when provided.

    Falls back to the default boto3 client which will read credentials from
    environment/instance metadata.
    """
    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        session = boto3.Session(
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION,
        )
        return session.client("s3")
    return boto3.client("s3", region_name=settings.AWS_REGION)


def upload_file(local_path: str, key: str, bucket: Optional[str] = None) -> str:
    """Upload `local_path` to S3 at `bucket`/`key`.

    Returns the s3:// URI on success. Raises on failure.
    """
    if not bucket:
        bucket = settings.S3_BUCKET_NAME
    if not bucket:
        raise ValueError("S3 bucket not configured (S3_BUCKET_NAME)")

    client = _get_s3_client()
    src = str(Path(local_path))

    try:
        client.upload_file(src, bucket, key)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Failed to upload %s to s3://%s/%s: %s", src, bucket, key, exc)
        raise

    return f"s3://{bucket}/{key}"
