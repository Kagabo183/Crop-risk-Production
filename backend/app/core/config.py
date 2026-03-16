from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Optional

# Resolve .env: prefer repo-root .env, fall back to backend/.env
_repo_root_env = Path(__file__).resolve().parents[3] / ".env"
_backend_env = Path(__file__).resolve().parents[2] / ".env"
_ENV_FILE = str(_repo_root_env) if _repo_root_env.exists() else str(_backend_env)


class Settings(BaseSettings):
    # ── API ────────────────────────────────────────────────────────────────────
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Crop Risk Prediction Platform"
    DEBUG: bool = True

    # ── Database ───────────────────────────────────────────────────────────────
    # Default supports basic imports/tests without env vars.
    # Production must override via DATABASE_URL environment variable.
    DATABASE_URL: str = "sqlite:///./app.db"
    DATABASE_HOST: Optional[str] = None
    DATABASE_PORT: Optional[int] = None
    DATABASE_NAME: Optional[str] = None
    DATABASE_USER: Optional[str] = None
    DATABASE_PASSWORD: Optional[str] = None

    # ── Redis ──────────────────────────────────────────────────────────────────
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None

    # ── JWT ────────────────────────────────────────────────────────────────────
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # ── External APIs (general) ────────────────────────────────────────────────
    SENTINEL_API_KEY: Optional[str] = None
    WEATHER_API_KEY: Optional[str] = None

    # ── Copernicus DataSpace ───────────────────────────────────────────────────
    COPERNICUS_USERNAME: Optional[str] = None
    COPERNICUS_PASSWORD: Optional[str] = None

    # ── Google Earth Engine ────────────────────────────────────────────────────
    # GEE_PRIVATE_KEY_PATH must point to the service account JSON file.
    # Docker convention: /app/keys/gee-service-account.json
    # (mount the file via a Docker volume — do NOT commit the key to git)
    GEE_PROJECT: Optional[str] = None
    GEE_SERVICE_ACCOUNT_EMAIL: Optional[str] = None
    GEE_PRIVATE_KEY_PATH: Optional[str] = None

    # ── Satellite data fallback ────────────────────────────────────────────────
    # Set USE_PLANETARY_COMPUTER=true to prefer/enforce PC over GEE
    USE_PLANETARY_COMPUTER: bool = False
    # STAC endpoint for Microsoft Planetary Computer
    MICROSOFT_PLANETARY_COMPUTER_API_STATIC_DOCUMENT: str = (
        "https://planetarycomputer.microsoft.com/api/stac/v1"
    )

    # ── Weather Data Sources ───────────────────────────────────────────────────
    ERA5_API_URL: Optional[str] = None      # Copernicus CDS API URL (optional override)
    ERA5_API_KEY: Optional[str] = None      # Copernicus Climate Data Store UID:key
    NOAA_API_KEY: Optional[str] = None      # NOAA Climate Data Online token
    IBM_EIS_API_KEY: Optional[str] = None   # IBM Environmental Intelligence Suite
    LOCAL_STATION_URL: Optional[str] = None # Local met-station API endpoint

    # ── Disease Prediction ─────────────────────────────────────────────────────
    DISEASE_FORECAST_DAYS: int = 7
    DISEASE_MODEL_VERSION: str = "v1.0"
    ENABLE_DAILY_FORECASTS: bool = True
    ENABLE_WEEKLY_SUMMARIES: bool = True
    REQUIRE_REAL_WEATHER: bool = True

    # ── Email ──────────────────────────────────────────────────────────────────
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: Optional[int] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    # ── SMS (Africa's Talking) ─────────────────────────────────────────────────
    SMS_PROVIDER: Optional[str] = None
    SMS_API_KEY: Optional[str] = None
    SMS_USERNAME: Optional[str] = None

    # ── AWS / S3 ───────────────────────────────────────────────────────────────
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: str = "eu-north-1"
    S3_BUCKET_NAME: Optional[str] = None

    # ── Frontend ───────────────────────────────────────────────────────────────
    MAPBOX_TOKEN: Optional[str] = None

    # ── Satellite storage mode ─────────────────────────────────────────────────
    SATELLITE_LOCAL_STORAGE_ENABLED: bool = True
    # When True, processed satellite files will be uploaded to S3 (if S3 configured)
    SATELLITE_UPLOAD_ON_PROCESS: bool = True
    # When True and upload succeeds, delete the local copy after uploading
    SATELLITE_UPLOAD_DELETE_LOCAL: bool = False
    # New defaults: do not persist rasters; metrics-only pipeline
    SATELLITE_STORE_RASTERS: bool = False
    SATELLITE_STORE_TILES: bool = False

    class Config:
        env_file = _ENV_FILE
        case_sensitive = True
        extra = "ignore"


settings = Settings()
