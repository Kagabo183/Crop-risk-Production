from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # API Settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Crop Risk Prediction Platform"
    DEBUG: bool = True

    # Database
    # Default supports basic imports/tests without env vars.
    # Production should override via environment variables.
    DATABASE_URL: str = "sqlite:///./app.db"
    DATABASE_HOST: Optional[str] = None
    DATABASE_PORT: Optional[int] = None
    DATABASE_NAME: Optional[str] = None
    DATABASE_USER: Optional[str] = None
    DATABASE_PASSWORD: Optional[str] = None

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None

    # JWT
    SECRET_KEY: str = "CHANGE_ME_IN_PRODUCTION"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # External APIs
    SENTINEL_API_KEY: Optional[str] = None
    WEATHER_API_KEY: Optional[str] = None
    
    # Weather Data Sources
    ERA5_API_URL: Optional[str] = None  # ECMWF/Copernicus Climate Data Store API URL
    ERA5_API_KEY: Optional[str] = None  # ECMWF/Copernicus Climate Data Store
    NOAA_API_KEY: Optional[str] = None  # NOAA Climate Data Online
    IBM_EIS_API_KEY: Optional[str] = None  # IBM Environmental Intelligence Suite
    LOCAL_STATION_URL: Optional[str] = None  # Local meteorological station API
    
    # Disease Prediction Settings
    DISEASE_FORECAST_DAYS: int = 7  # Default forecast horizon
    DISEASE_MODEL_VERSION: str = "v1.0"
    ENABLE_DAILY_FORECASTS: bool = True
    ENABLE_WEEKLY_SUMMARIES: bool = True
    REQUIRE_REAL_WEATHER: bool = True  # Disallow fallback/climatology weather inputs

    # Email (for alerts)
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: Optional[int] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    # SMS (Africa's Talking)
    SMS_PROVIDER: Optional[str] = None
    SMS_API_KEY: Optional[str] = None
    SMS_USERNAME: Optional[str] = None

    # Storage
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    S3_BUCKET_NAME: Optional[str] = None

    # Satellite storage mode
    SATELLITE_LOCAL_STORAGE_ENABLED: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()
