"""
Google Earth Engine singleton manager.

Initialized ONCE at application startup.  All satellite services should call
is_initialized() to check status rather than re-initializing per request.

Key-file resolution order:
  1. GEE_PRIVATE_KEY_PATH env var (absolute or relative path)
  2. /app/keys/gee-service-account.json  (Docker convention)
  3. ./Gee_Key/*.json                    (local-dev convenience)
"""
import glob
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_gee_initialized: bool = False
_gee_error: Optional[str] = None


def _resolve_key_path(configured_path: Optional[str]) -> Optional[str]:
    """
    Return the first readable GEE service-account JSON file found.
    Falls back to Docker convention and then a local-dev glob.
    """
    candidates = []
    if configured_path:
        candidates.append(configured_path)
    candidates.append("/app/keys/gee-service-account.json")
    candidates.extend(glob.glob("./Gee_Key/*.json"))
    candidates.extend(glob.glob("Gee_Key/*.json"))

    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def initialize() -> bool:
    """
    Try to initialize GEE.  Safe to call multiple times — subsequent calls
    are no-ops when already successful.  Returns True on success.
    """
    global _gee_initialized, _gee_error

    if _gee_initialized:
        return True

    try:
        import ee
        from app.core.config import settings

        email   = getattr(settings, "GEE_SERVICE_ACCOUNT_EMAIL", None)
        project = getattr(settings, "GEE_PROJECT", None) or "principal-rhino-482514-f1"
        key_path = _resolve_key_path(getattr(settings, "GEE_PRIVATE_KEY_PATH", None))

        if email and key_path:
            if not os.path.isfile(key_path):
                raise FileNotFoundError(
                    f"GEE service-account key not found at '{key_path}'. "
                    "Mount it as a Docker volume or set GEE_PRIVATE_KEY_PATH correctly."
                )
            credentials = ee.ServiceAccountCredentials(email, key_path)
            ee.Initialize(credentials, project=project)
            logger.info("✓ GEE initialized — service account: %s", email)
        elif email:
            logger.warning(
                "GEE_SERVICE_ACCOUNT_EMAIL is set but no key file was found. "
                "Falling back to application-default credentials."
            )
            ee.Initialize(project=project)
            logger.info("✓ GEE initialized — application-default credentials")
        else:
            ee.Initialize(project=project)
            logger.info("✓ GEE initialized — project: %s (application-default)", project)

        _gee_initialized = True
        _gee_error = None
        return True

    except Exception as exc:
        _gee_error = str(exc)
        logger.warning(
            "⚠ GEE initialization failed — satellite features will use "
            "Planetary Computer fallback. Error: %s",
            exc,
        )
        return False


def is_initialized() -> bool:
    """Return True if GEE has been successfully initialized."""
    return _gee_initialized


def get_error() -> Optional[str]:
    """Return the last initialization error message, or None if successful."""
    return _gee_error


def get_status() -> dict:
    """Return a dict suitable for health-check responses."""
    return {
        "initialized": _gee_initialized,
        "error": _gee_error,
    }

