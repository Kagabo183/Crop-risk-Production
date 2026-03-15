"""
Geo-intelligence Celery tasks
-------------------------------
Task names:
  geo_intelligence.compute_productivity_zones   – single farm
  geo_intelligence.compute_all_farms_zones      – all farms
  geo_intelligence.full_geo_analysis            – zones + overlay (single farm)
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="geo_intelligence.compute_productivity_zones",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def compute_productivity_zones_task(
    self, farm_id: int, n_zones: int = 3, days_back: int = 90
):
    """Compute and persist K-means productivity zones for a single farm."""
    from app.db.database import SessionLocal
    from app.models.farm import Farm as FarmModel
    from app.services.productivity_zone_service import ProductivityZoneService

    db = SessionLocal()
    try:
        farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
        if not farm:
            return {"farm_id": farm_id, "status": "skipped", "reason": "not_found"}
        if not (farm.latitude and farm.longitude):
            return {"farm_id": farm_id, "status": "skipped", "reason": "no_coordinates"}

        zones = ProductivityZoneService().compute_and_save(
            farm=farm, db=db, n_zones=n_zones, days_back=days_back
        )
        return {"farm_id": farm_id, "status": "success", "zones_computed": len(zones)}

    except Exception as exc:
        logger.error("compute_productivity_zones failed for farm %s: %s", farm_id, exc)
        raise self.retry(exc=exc)
    finally:
        db.close()


@shared_task(name="geo_intelligence.compute_all_farms_zones", bind=False)
def compute_all_farms_zones_task():
    """Enqueue productivity zone computation for all farms that have coordinates."""
    from app.db.database import SessionLocal
    from app.models.farm import Farm as FarmModel

    db = SessionLocal()
    counts = {"total": 0, "queued": 0, "skipped": 0}
    try:
        farms = (
            db.query(FarmModel)
            .filter(FarmModel.latitude.isnot(None), FarmModel.longitude.isnot(None))
            .all()
        )
        counts["total"] = len(farms)
        for farm in farms:
            try:
                compute_productivity_zones_task.delay(farm.id)
                counts["queued"] += 1
            except Exception:
                counts["skipped"] += 1
        return counts
    finally:
        db.close()


@shared_task(
    name="geo_intelligence.full_geo_analysis",
    bind=True,
    max_retries=1,
    default_retry_delay=60,
)
def full_geo_analysis_task(self, farm_id: int):
    """
    Full geo-intelligence pipeline for a single farm:
    enqueues productivity zone computation (zones feed the NDVI overlay endpoint).
    """
    try:
        compute_productivity_zones_task.delay(farm_id)
        return {"farm_id": farm_id, "status": "queued", "tasks": ["productivity_zones"]}
    except Exception as exc:
        logger.error("full_geo_analysis failed for farm %s: %s", farm_id, exc)
        raise self.retry(exc=exc)
