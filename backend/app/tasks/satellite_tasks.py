"""
Celery tasks for satellite data processing
"""
from celery import shared_task
from datetime import datetime, timedelta
from app.db.database import SessionLocal
from app.services.satellite_service import SatelliteDataService
from app.services.stress_detection_service import StressDetectionService
from app.models.farm import Farm
from app.models.alert import Alert
import logging

logger = logging.getLogger(__name__)


@shared_task(name="satellite.fetch_all_farms_imagery")
def fetch_all_farms_imagery():
    """
    Fetch satellite imagery for all farms
    Scheduled to run every 3 days
    """
    db = SessionLocal()
    try:
        satellite_service = SatelliteDataService()
        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None),
            Farm.longitude.isnot(None)
        ).all()
        
        logger.info(f"Fetching satellite imagery for {len(farms)} farms")
        
        results = {
            'success': 0,
            'failed': 0,
            'no_data': 0
        }
        
        for farm in farms:
            try:
                metrics = satellite_service.process_farm_imagery(
                    db=db,
                    farm_id=farm.id,
                    days_back=7  # Look back 7 days for new imagery
                )
                
                if metrics:
                    results['success'] += 1
                    logger.info(f"Processed {len(metrics)} observations for farm {farm.id}")
                else:
                    results['no_data'] += 1
                    logger.warning(f"No imagery found for farm {farm.id}")
                    
            except Exception as e:
                results['failed'] += 1
                logger.error(f"Failed to process farm {farm.id}: {e}")
        
        logger.info(f"Satellite fetch complete: {results}")
        return results
        
    except Exception as e:
        logger.error(f"Error in fetch_all_farms_imagery: {e}")
        raise
    finally:
        db.close()


@shared_task(name="satellite.calculate_vegetation_indices")
def calculate_vegetation_indices(farm_id: int):
    """
    Calculate vegetation indices for a specific farm's latest imagery
    Triggered after new imagery download
    """
    db = SessionLocal()
    try:
        satellite_service = SatelliteDataService()
        
        # Process imagery for the farm
        metrics = satellite_service.process_farm_imagery(
            db=db,
            farm_id=farm_id,
            days_back=3
        )
        
        logger.info(f"Calculated indices for {len(metrics)} observations for farm {farm_id}")
        return {'farm_id': farm_id, 'observations_processed': len(metrics)}
        
    except Exception as e:
        logger.error(f"Error calculating vegetation indices for farm {farm_id}: {e}")
        raise
    finally:
        db.close()


@shared_task(name="satellite.detect_stress_zones")
def detect_stress_zones():
    """
    Detect stressed zones for all farms
    Scheduled to run daily
    """
    db = SessionLocal()
    try:
        stress_service = StressDetectionService()
        farms = db.query(Farm).all()
        
        logger.info(f"Detecting stress for {len(farms)} farms")
        
        results = {
            'farms_processed': 0,
            'high_stress_farms': 0,
            'alerts_created': 0
        }
        
        for farm in farms:
            try:
                # Get composite health assessment
                assessment = stress_service.calculate_composite_health_score(db, farm.id)
                
                # Update vegetation health record
                stress_service.update_vegetation_health_record(
                    db=db,
                    farm_id=farm.id,
                    date=datetime.now().date()
                )
                
                results['farms_processed'] += 1
                
                # Create alerts for high stress
                if assessment['stress_score'] >= 60:
                    results['high_stress_farms'] += 1
                    
                    # Check for existing alert today to avoid spam
                    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                    existing_alert = db.query(Alert).filter(
                        Alert.farm_id == farm.id,
                        Alert.created_at >= today_start
                    ).first()
                    
                    if not existing_alert:
                        level_map = {'severe': 'critical', 'high': 'high', 'moderate': 'medium'}
                        stress_level = assessment.get('stress_level', 'high')
                        alert_level = level_map.get(stress_level, 'high')

                        # Default to farmer-friendly message (most users are farmers)
                        message = assessment.get('message_farmer', assessment.get('message'))

                        # Action days from assessment (now includes this info)
                        action_days_min = assessment.get('action_days_min')
                        action_days_max = assessment.get('action_days_max')

                        # Fallback if not in assessment
                        if action_days_min is None or action_days_max is None:
                            action_days_map = {'severe': (1, 3), 'high': (2, 5), 'moderate': (5, 10)}
                            action_days = action_days_map.get(stress_level, (5, 10))
                            action_days_min, action_days_max = action_days

                        new_alert = Alert(
                            farm_id=farm.id,
                            message=message,
                            level=alert_level,
                            alert_type='vegetation_stress',
                            source='satellite',
                            severity=stress_level,
                            action_days_min=action_days_min,
                            action_days_max=action_days_max,
                            alert_data={
                                'message_farmer': assessment.get('message_farmer'),
                                'message_technical': assessment.get('message_technical'),
                                'action': assessment.get('action'),
                                'health_score': assessment.get('health_score'),
                                'stress_score': assessment.get('stress_score'),
                                'primary_stress': assessment.get('primary_stress'),
                                'stress_breakdown': assessment.get('stress_breakdown')
                            }
                        )
                        db.add(new_alert)
                        db.commit()
                        results['alerts_created'] += 1
                        logger.warning(f"Created alert for farm {farm.id}: {alert_level}")
                    else:
                        logger.info(f"Alert already exists for farm {farm.id} today")
                    
            except Exception as e:
                logger.error(f"Failed to detect stress for farm {farm.id}: {e}")
        
        logger.info(f"Stress detection complete: {results}")
        return results
        
    except Exception as e:
        logger.error(f"Error in detect_stress_zones: {e}")
        raise
    finally:
        db.close()


@shared_task(name="satellite.generate_risk_heatmaps")
def generate_risk_heatmaps():
    """
    Generate regional risk heatmaps
    Scheduled to run weekly
    """
    db = SessionLocal()
    try:
        # This would generate heatmap data for visualization
        # For now, just log the task
        logger.info("Generating risk heatmaps (placeholder)")
        
        return {'status': 'completed', 'message': 'Heatmap generation placeholder'}
        
    except Exception as e:
        logger.error(f"Error generating risk heatmaps: {e}")
        raise
    finally:
        db.close()


@shared_task(name="satellite.process_single_farm", bind=True, soft_time_limit=90, time_limit=120)
def process_single_farm(self, farm_id: int, days_back: int = 30):
    """
    Process satellite data for a single farm (on-demand).

    Uses the fast GEE metrics-only pipeline (no raster downloads).
    Progress is reported via Celery state updates and always reaches 100%.
    """
    from app.services.fast_vegetation_service import quick_scan

    db = SessionLocal()
    try:
        # ── Stage 1: Starting ────────────────────────────────────────────
        self.update_state(state='PROGRESS', meta={
            'percent': 10, 'stage': 'Starting satellite scan...',
            'farm_id': farm_id,
        })

        # ── Stage 2: GEE initialisation + imagery fetch ──────────────────
        self.update_state(state='PROGRESS', meta={
            'percent': 30, 'stage': 'Fetching Sentinel-2 imagery...',
            'farm_id': farm_id,
        })

        # ── Stage 3: Computing indices ───────────────────────────────────
        self.update_state(state='PROGRESS', meta={
            'percent': 60, 'stage': 'Computing vegetation indices...',
            'farm_id': farm_id,
        })

        result = quick_scan(farm_id, db, days_back=days_back)

        # ── Stage 4: Saved to DB ─────────────────────────────────────────
        self.update_state(state='PROGRESS', meta={
            'percent': 90, 'stage': 'Saving to database...',
            'farm_id': farm_id,
        })

        # ── Stage 5: Done ────────────────────────────────────────────────
        logger.info(
            "process_single_farm OK for farm %s: NDVI=%.4f health=%.1f",
            farm_id,
            result.get('ndvi_mean') or 0,
            result.get('health_score') or 0,
        )

        return {
            'percent': 100,
            'stage': 'Complete',
            'farm_id': farm_id,
            'ndvi_mean': result.get('ndvi_mean'),
            'ndre_mean': result.get('ndre_mean'),
            'evi_mean': result.get('evi_mean'),
            'savi_mean': result.get('savi_mean'),
            'health_score': result.get('health_score'),
            'images_found': result.get('images_found'),
            'observation_date': result.get('observation_date'),
        }

    except Exception as exc:
        logger.error("process_single_farm FAILED for farm %s: %s", farm_id, exc, exc_info=True)
        self.update_state(state='FAILURE', meta={
            'percent': 0,
            'stage': f'Scan failed: {exc}',
            'farm_id': farm_id,
        })
        # Return instead of raising so the task ends cleanly
        return {
            'percent': 0,
            'stage': 'Failed',
            'farm_id': farm_id,
            'error': str(exc),
        }
    finally:
        db.close()
