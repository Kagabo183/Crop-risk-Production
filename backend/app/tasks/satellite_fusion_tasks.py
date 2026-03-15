"""
Celery tasks for multi-satellite data fusion and crop phenology detection.

Pipeline position (runs after satellite.fetch_all_farms_imagery):
  satellite.fetch_all_farms_imagery  (every 3 days)
        ↓
  satellite_fusion.run_fusion_all_farms  (every 3 days, +30 min offset)
        ↓
  phenology.detect_all_farms  (weekly, Monday 02:00 UTC)
"""
import logging

from celery import shared_task

from app.db.database import SessionLocal
from app.models.farm import Farm

logger = logging.getLogger(__name__)


@shared_task(name="satellite_fusion.run_fusion_all_farms", bind=True, max_retries=2)
def run_fusion_all_farms(self):
    """
    Run multi-satellite data fusion (Sentinel-1 SAR + Sentinel-2 + Landsat)
    for every farm that has coordinates.

    - Fills cloud-covered dates with SAR-derived NDVI estimates.
    - Falls back to Landsat when neither optical nor SAR is available.
    - Persists merged observations to the satellite_images table.
    """
    from app.services.satellite_fusion_service import SatelliteFusionService

    db = SessionLocal()
    svc = SatelliteFusionService()
    results = {"success": 0, "skipped": 0, "failed": 0}

    try:
        farms = (
            db.query(Farm)
            .filter(Farm.latitude.isnot(None), Farm.longitude.isnot(None))
            .all()
        )
        logger.info("Satellite fusion: processing %d farms", len(farms))

        for farm in farms:
            try:
                summary = svc.run_fusion(farm, db, days_back=15)
                if summary.get("observations_added", 0) > 0:
                    results["success"] += 1
                    logger.info(
                        "Fusion OK farm %s: %d new obs (SAR fills=%d, Landsat=%d)",
                        farm.id,
                        summary["observations_added"],
                        summary.get("sar_filled", 0),
                        summary.get("landsat_filled", 0),
                    )
                else:
                    results["skipped"] += 1
            except Exception as exc:
                results["failed"] += 1
                logger.error("Fusion failed farm %s: %s", farm.id, exc)

        logger.info("Satellite fusion complete: %s", results)
        return results

    except Exception as exc:
        logger.error("run_fusion_all_farms fatal: %s", exc)
        raise self.retry(exc=exc, countdown=300)
    finally:
        db.close()


@shared_task(name="satellite_fusion.run_fusion_single_farm", bind=True, max_retries=3)
def run_fusion_single_farm(self, farm_id: int, days_back: int = 15):
    """
    Run fusion for a single farm (triggered on-demand or by webhook).
    Returns a summary dict with observations_added / sar_filled / landsat_filled.
    """
    from app.services.satellite_fusion_service import SatelliteFusionService

    db = SessionLocal()
    try:
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            return {"error": f"Farm {farm_id} not found"}

        svc = SatelliteFusionService()
        result = svc.run_fusion(farm, db, days_back=days_back)
        return result

    except Exception as exc:
        logger.error("Fusion single farm %s failed: %s", farm_id, exc)
        raise self.retry(exc=exc, countdown=120)
    finally:
        db.close()


@shared_task(name="phenology.detect_all_farms", bind=True, max_retries=2)
def detect_phenology_all_farms(self):
    """
    Detect crop growth stage (phenology) for every farm using NDVI time-series.

    Uses 180-day NDVI curve derivative analysis + GDD cross-validation.
    Persists a PhenologyRecord per farm.  Runs weekly (Monday 02:00 UTC).
    """
    from app.services.phenology_service import PhenologyService

    db = SessionLocal()
    svc = PhenologyService()
    results = {"success": 0, "insufficient_data": 0, "failed": 0}

    try:
        farms = (
            db.query(Farm)
            .filter(Farm.latitude.isnot(None), Farm.longitude.isnot(None))
            .all()
        )
        logger.info("Phenology detection: processing %d farms", len(farms))

        for farm in farms:
            try:
                result = svc.detect_growth_stage(farm, db, window_days=180)
                svc.save_phenology_record(result, db)
                if result.get("ndvi_series_used", 0) < 4:
                    results["insufficient_data"] += 1
                else:
                    results["success"] += 1
                    logger.info(
                        "Phenology farm %s: stage=%s confidence=%.2f method=%s",
                        farm.id,
                        result.get("detected_stage"),
                        result.get("confidence", 0),
                        result.get("detection_method"),
                    )
            except Exception as exc:
                results["failed"] += 1
                logger.error("Phenology failed farm %s: %s", farm.id, exc)

        logger.info("Phenology detection complete: %s", results)
        return results

    except Exception as exc:
        logger.error("detect_phenology_all_farms fatal: %s", exc)
        raise self.retry(exc=exc, countdown=300)
    finally:
        db.close()


@shared_task(name="phenology.detect_single_farm", bind=True, max_retries=3)
def detect_phenology_single_farm(self, farm_id: int, window_days: int = 180):
    """
    Run phenology detection for a single farm (on-demand / API-triggered).
    """
    from app.services.phenology_service import PhenologyService

    db = SessionLocal()
    try:
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            return {"error": f"Farm {farm_id} not found"}

        svc = PhenologyService()
        result = svc.detect_growth_stage(farm, db, window_days=window_days)
        svc.save_phenology_record(result, db)
        return result

    except Exception as exc:
        logger.error("Phenology single farm %s failed: %s", farm_id, exc)
        raise self.retry(exc=exc, countdown=60)
    finally:
        db.close()
