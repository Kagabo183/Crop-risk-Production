"""
Precision Agriculture Celery Tasks
====================================
Background tasks for VRA computation and yield analysis.
"""
from celery import shared_task
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


@shared_task(
    name="precision_ag.compute_vra_all_farms",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def compute_vra_all_farms(self):
    """
    Weekly task: regenerate VRA fertilizer maps for all farms that have
    productivity zones and at least one active season.
    """
    try:
        from app.db.database import SessionLocal
        from app.models.farm import Farm
        from app.models.precision_ag import Season, SeasonStatus
        from app.models.geo_intelligence import ProductivityZone
        from app.services import vra_service
        from sqlalchemy import distinct

        db = SessionLocal()
        try:
            # Find farms that have both zones and an active season
            farm_ids_with_zones = (
                db.query(distinct(ProductivityZone.farm_id)).all()
            )
            farm_ids_with_zones = {r[0] for r in farm_ids_with_zones}

            farm_ids_active = (
                db.query(distinct(Season.farm_id))
                .filter(Season.status == SeasonStatus.active)
                .all()
            )
            farm_ids_active = {r[0] for r in farm_ids_active}

            target_ids = farm_ids_with_zones & farm_ids_active
            logger.info(f"[VRA] Recomputing fertilizer VRA for {len(target_ids)} farms")

            for farm_id in target_ids:
                try:
                    season = (
                        db.query(Season)
                        .filter(Season.farm_id == farm_id, Season.status == SeasonStatus.active)
                        .order_by(Season.created_at.desc())
                        .first()
                    )
                    vra_service.generate_vra_map(
                        farm_id=farm_id,
                        prescription_type="fertilizer",
                        base_rate=100.0,          # default 100 kg/ha NPK
                        product_name="NPK Fertilizer",
                        season_id=season.id if season else None,
                        db=db,
                    )
                except Exception as e:
                    logger.warning(f"[VRA] Farm {farm_id} failed: {e}")

            return {"status": "ok", "farms_processed": len(target_ids)}
        finally:
            db.close()
    except Exception as exc:
        logger.error(f"[VRA] compute_vra_all_farms error: {exc}")
        raise self.retry(exc=exc)


@shared_task(
    name="precision_ag.generate_rotation_analysis_all",
    bind=True,
    max_retries=1,
)
def generate_rotation_analysis_all(self):
    """
    Weekly task: generate / refresh crop rotation records for all
    active seasons.
    """
    try:
        from app.db.database import SessionLocal
        from app.models.precision_ag import Season, SeasonStatus
        from app.services import season_service

        db = SessionLocal()
        try:
            active_seasons = (
                db.query(Season)
                .filter(Season.status.in_([SeasonStatus.active, SeasonStatus.planning]))
                .all()
            )
            logger.info(f"[Rotation] Processing {len(active_seasons)} seasons")

            updated = 0
            for s in active_seasons:
                try:
                    season_service.generate_crop_rotation(s.farm_id, s.id, db)
                    updated += 1
                except Exception as e:
                    logger.warning(f"[Rotation] Season {s.id} failed: {e}")

            return {"status": "ok", "seasons_processed": updated}
        finally:
            db.close()
    except Exception as exc:
        logger.error(f"[Rotation] error: {exc}")
        raise self.retry(exc=exc)
