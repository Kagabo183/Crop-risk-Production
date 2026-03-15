"""
Startup validation — runs once when the FastAPI application boots.

Each check logs a clear WARNING (never raises) so a single missing service
cannot prevent the rest of the platform from starting.  Critical failures
(database, Redis) are logged with ERROR level so they are easy to spot in
deployment logs.
"""
import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _ok(name: str, detail: str = "") -> Dict:
    msg = f"✓ {name}" + (f" — {detail}" if detail else "")
    logger.info(msg)
    return {"service": name, "status": "ok", "detail": detail}


def _warn(name: str, detail: str) -> Dict:
    logger.warning("⚠ %s — %s", name, detail)
    return {"service": name, "status": "warning", "detail": detail}


def _fail(name: str, detail: str) -> Dict:
    logger.error("✗ %s — %s", name, detail)
    return {"service": name, "status": "error", "detail": detail}


# ─── individual checks ─────────────────────────────────────────────────────────

def check_database() -> Dict:
    try:
        from sqlalchemy import text
        from app.db.database import engine
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return _ok("Database", str(engine.url).split("@")[-1])  # hide credentials
    except Exception as exc:
        return _fail("Database", str(exc))


def check_redis() -> Dict:
    try:
        import redis as redis_lib
        from app.core.config import settings
        r = redis_lib.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            socket_connect_timeout=3,
        )
        r.ping()
        return _ok("Redis", f"{settings.REDIS_HOST}:{settings.REDIS_PORT}")
    except Exception as exc:
        return _fail("Redis", str(exc))


def check_gee() -> Dict:
    from app.core import gee_manager
    if gee_manager.is_initialized():
        return _ok("Google Earth Engine")
    err = gee_manager.get_error() or "not initialized"
    return _warn("Google Earth Engine", err + " (Planetary Computer fallback active)")


def check_gee_key_file() -> Dict:
    from app.core.config import settings
    path = getattr(settings, "GEE_PRIVATE_KEY_PATH", None)
    if not path:
        return _warn("GEE key file", "GEE_PRIVATE_KEY_PATH not set")
    if os.path.isfile(path):
        return _ok("GEE key file", path)
    # Check Docker convention path as fallback
    docker_path = "/app/keys/gee-service-account.json"
    if os.path.isfile(docker_path):
        return _ok("GEE key file", f"found at Docker path: {docker_path}")
    return _warn(
        "GEE key file",
        f"not found at '{path}'. Mount it via Docker volume: "
        "-v /host/path/key.json:/app/keys/gee-service-account.json:ro",
    )


def check_planetary_computer() -> Dict:
    try:
        from app.core.config import settings
        import requests
        stac_url = settings.MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT
        resp = requests.get(stac_url, timeout=5)
        if resp.status_code == 200:
            return _ok("Planetary Computer STAC", stac_url)
        return _warn("Planetary Computer STAC", f"HTTP {resp.status_code} from {stac_url}")
    except Exception as exc:
        return _warn("Planetary Computer STAC", str(exc))


def check_era5() -> Dict:
    from app.core.config import settings
    if settings.ERA5_API_KEY:
        return _ok("ERA5 (Copernicus CDS)", "API key configured")
    return _warn("ERA5 (Copernicus CDS)", "ERA5_API_KEY not set — ERA5 weather source unavailable")


def check_noaa() -> Dict:
    from app.core.config import settings
    if settings.NOAA_API_KEY:
        return _ok("NOAA CDO", "API token configured")
    return _warn("NOAA CDO", "NOAA_API_KEY not set — NOAA weather source unavailable")


def check_aws() -> Dict:
    from app.core.config import settings
    if settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY:
        return _ok("AWS S3", f"region={settings.AWS_REGION}")
    return _warn("AWS S3", "AWS credentials not set — S3 storage unavailable")


# ─── main entry point ──────────────────────────────────────────────────────────

def run_all() -> Dict:
    """
    Run all startup checks and return a summary dict.
    Called from FastAPI startup event — never raises.
    """
    logger.info("=" * 60)
    logger.info("  Crop Risk Platform — startup validation")
    logger.info("=" * 60)

    results = [
        check_database(),
        check_redis(),
        check_gee(),
        check_gee_key_file(),
        check_planetary_computer(),
        check_era5(),
        check_noaa(),
        check_aws(),
    ]

    statuses = [r["status"] for r in results]
    n_ok    = statuses.count("ok")
    n_warn  = statuses.count("warning")
    n_err   = statuses.count("error")

    logger.info("─" * 60)
    logger.info(
        "Validation complete: %d OK / %d warnings / %d errors", n_ok, n_warn, n_err
    )
    if n_err:
        logger.error(
            "Critical services failed — check the ERROR messages above before "
            "sending traffic to this instance."
        )
    logger.info("=" * 60)

    return {
        "ok": n_ok,
        "warnings": n_warn,
        "errors": n_err,
        "checks": results,
    }
