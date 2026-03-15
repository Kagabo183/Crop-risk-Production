"""
Google Earth Engine singleton manager.

Initialized ONCE at application startup. All satellite services should call
is_initialized() to check status rather than re-initializing every request.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_gee_initialized: bool = False
_gee_error: Optional[str] = None


def initialize() -> bool:
    """
    Try to initialize GEE. Safe to call multiple times — subsequent calls
    are no-ops when already initialized. Returns True on success.
    """
    global _gee_initialized, _gee_error

    if _gee_initialized:
        return True

    try:
        import ee
        from app.core.config import settings

        # Support both GEE_SERVICE_ACCOUNT_EMAIL and legacy GEE_SERVICE_ACCOUNT env var
        email = getattr(settings, "GEE_SERVICE_ACCOUNT_EMAIL", None)
        key_path = getattr(settings, "GEE_PRIVATE_KEY_PATH", None)
        project = getattr(settings, "GEE_PROJECT", None) or "principal-rhino-482514-f1"

        if email and key_path:
            credentials = ee.ServiceAccountCredentials(email, key_path)
            ee.Initialize(credentials, project=project)
            logger.info("✓ GEE initialized with service account (%s)", email)
        else:
            ee.Initialize(project=project)
            logger.info("✓ GEE initialized with project: %s", project)

        _gee_initialized = True
        _gee_error = None
        return True

    except Exception as exc:
        _gee_error = str(exc)
        logger.warning(
            "GEE initialization failed — satellite boundary/index features will "
            "use Planetary Computer fallback. Error: %s",
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
