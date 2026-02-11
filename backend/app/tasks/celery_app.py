from celery import Celery
from celery.schedules import crontab
import os

# Broker/res backend configuration - prefer explicit env vars set by the environment
BROKER = os.environ.get('CELERY_BROKER_URL') or (f"redis://{os.environ.get('REDIS_URL') or os.environ.get('REDIS_HOST','redis')}:6379/0")
RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND') or os.environ.get('CELERY_RESULT_BACKEND')

celery_app = Celery('crop_risk')
celery_app.conf.broker_url = BROKER
if RESULT_BACKEND:
    celery_app.conf.result_backend = RESULT_BACKEND
celery_app.conf.task_serializer = 'json'
celery_app.conf.result_serializer = 'json'
celery_app.conf.accept_content = ['json']

# Run periodic scanner every 10 minutes to auto-enqueue processing of new TIFFs
celery_app.conf.timezone = 'UTC'

local_storage_enabled = os.environ.get('SATELLITE_LOCAL_STORAGE_ENABLED', 'true').lower() in (
    '1', 'true', 'yes', 'on'
)

beat_schedule = {
    # ============ WEATHER TASKS (Critical for disease prediction) ============
    'fetch-weather-every-6-hours': {
        'task': 'weather.fetch_all_farms_weather',
        'schedule': crontab(minute=0, hour='*/6'),  # Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
        'args': (),
    },
    'fetch-weather-forecast-daily': {
        'task': 'weather.fetch_weather_forecast',
        'schedule': crontab(minute=0, hour=0),  # Daily at midnight UTC
        'args': (),
    },
    'check-extreme-weather-every-3-hours': {
        'task': 'weather.check_extreme_conditions',
        'schedule': crontab(minute=0, hour='*/3'),  # Every 3 hours
        'args': (),
    },

    # ============ SATELLITE TASKS ============
    'fetch-satellite-imagery-every-3-days': {
        'task': 'satellite.fetch_all_farms_imagery',
        'schedule': crontab(minute=0, hour=2, day_of_week='*/3'),  # Every 3 days at 2 AM UTC
        'args': (),
    },
    'detect-stress-zones-daily': {
        'task': 'satellite.detect_stress_zones',
        'schedule': crontab(minute=0, hour=4),  # Daily at 4 AM UTC
        'args': (),
    },

    # ============ DISEASE PREDICTION TASKS ============
    'generate-disease-predictions-daily': {
        'task': 'app.tasks.process_tasks.generate_disease_predictions_task',
        'schedule': crontab(minute=0, hour=6),  # Daily at 06:00 UTC (after weather fetch)
        'args': (),
    },

    # ============ ML TASKS ============
    'ml-batch-risk-assessment-daily': {
        'task': 'ml.batch_risk_assessment',
        'schedule': crontab(minute=30, hour=6),  # Daily at 06:30 UTC (after disease predictions)
        'args': (),
    },
    'ml-detect-anomalies-daily': {
        'task': 'ml.detect_anomalies_all_farms',
        'schedule': crontab(minute=0, hour=5),  # Daily at 05:00 UTC (after satellite processing)
        'args': (),
    },
    'ml-generate-health-forecasts-daily': {
        'task': 'ml.generate_health_forecasts',
        'schedule': crontab(minute=0, hour=7),  # Daily at 07:00 UTC
        'args': (),
    },
    'ml-model-health-check-hourly': {
        'task': 'ml.model_health_check',
        'schedule': crontab(minute=0, hour='*/6'),  # Every 6 hours
        'args': (),
    },
    'ml-retrain-models-weekly': {
        'task': 'ml.retrain_all_models',
        'schedule': crontab(minute=0, hour=1, day_of_week='sunday'),  # Weekly on Sunday at 1 AM
        'args': (),
    },
}

if local_storage_enabled:
    beat_schedule['scan-sentinel2-every-10-mins'] = {
        'task': 'app.tasks.process_tasks.scan_and_enqueue',
        'schedule': 600.0,
        'args': (),
    }

celery_app.conf.beat_schedule = beat_schedule


@celery_app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
