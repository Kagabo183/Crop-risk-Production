"""
Celery tasks for the Auto Crop Risk pipeline.

Tasks:
  - analyze_single_farm_risk : on-demand (triggered by farm create/update)
  - analyze_all_farms_risk   : daily scheduled job (06:30 UTC)
"""

from celery import shared_task
from datetime import datetime
import logging

from app.db.database import SessionLocal

logger = logging.getLogger(__name__)


@shared_task(name="auto_crop_risk.analyze_single_farm", bind=True, max_retries=2)
def analyze_single_farm_risk(self, farm_id: int, days_back: int = 15):
    """
    Run auto crop risk analysis for a single farm.
    Triggered automatically when a farm is created or updated.
    """
    db = SessionLocal()
    try:
        from app.services.auto_crop_risk_service import AutoCropRiskService

        self.update_state(state="PROGRESS", meta={
            "percent": 10,
            "stage": "Starting auto crop risk analysis…",
            "farm_id": farm_id,
        })

        service = AutoCropRiskService()

        self.update_state(state="PROGRESS", meta={
            "percent": 30,
            "stage": "Fetching satellite imagery & computing indices…",
            "farm_id": farm_id,
        })

        result = service.analyze_farm_risk(
            db=db,
            farm_id=farm_id,
            days_back=days_back,
            force_refresh=True,
        )

        self.update_state(state="PROGRESS", meta={
            "percent": 100,
            "stage": "Complete",
            "farm_id": farm_id,
        })

        logger.info(
            f"✓ Auto crop risk for farm {farm_id}: "
            f"score={result['composite_health_score']}, "
            f"status={result['health_status']}"
        )

        return {
            "farm_id": farm_id,
            "composite_health_score": result["composite_health_score"],
            "health_status": result["health_status"],
            "detected_risk": result["detected_risk"],
            "analysis_timestamp": result["analysis_timestamp"],
        }

    except Exception as exc:
        logger.error(f"Auto crop risk failed for farm {farm_id}: {exc}")
        raise self.retry(exc=exc, countdown=60)
    finally:
        db.close()


@shared_task(name="auto_crop_risk.analyze_all_farms")
def analyze_all_farms_risk():
    """
    Daily scheduled task — runs auto crop risk analysis on all farms.
    Scheduled at 06:30 UTC via Celery Beat.
    """
    db = SessionLocal()
    try:
        from app.services.auto_crop_risk_service import AutoCropRiskService

        service = AutoCropRiskService()
        summary = service.analyze_all_farms(db)

        logger.info(
            f"✓ Daily auto crop risk complete — "
            f"total={summary['total']}, success={summary['success']}, "
            f"failed={summary['failed']}"
        )
        return summary

    except Exception as exc:
        logger.error(f"Daily auto crop risk batch failed: {exc}")
        raise
    finally:
        db.close()
