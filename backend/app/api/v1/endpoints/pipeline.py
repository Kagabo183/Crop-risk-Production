"""
Pipeline API Endpoints
- Multi-level analytics (Province, District, Farm)
- Manual data fetch trigger
- Pipeline status
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Dict, List, Any, Optional
from datetime import datetime
from sqlalchemy import text

from app.db.database import get_db
from app.db.database import SessionLocal
from app.services.pipeline_service import get_pipeline_service, PipelineService
from app.models.prediction import Prediction as PredictionModel
from app.models.farm import Farm as FarmModel

router = APIRouter()

# Track pipeline status
_pipeline_status = {
    'is_running': False,
    'last_run': None,
    'last_result': None
}

_risk_prediction_status = {
    'is_running': False,
    'last_run': None,
    'last_result': None,
}


@router.get("/status")
def get_pipeline_status() -> Dict[str, Any]:
    """Get current pipeline status"""
    pipeline = get_pipeline_service()
    summary = pipeline.get_prediction_summary()
    
    return {
        'is_running': _pipeline_status['is_running'],
        'last_run': _pipeline_status['last_run'],
        'last_result': _pipeline_status['last_result'],
        'summary': summary
    }


@router.post("/fetch-data")
async def trigger_data_fetch(background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Manually trigger satellite data fetching"""
    global _pipeline_status
    
    if _pipeline_status['is_running']:
        return {
            'status': 'already_running',
            'message': 'Pipeline is already running. Please wait for completion.'
        }
    
    # Run in background
    background_tasks.add_task(run_pipeline_task)
    
    return {
        'status': 'started',
        'message': 'Data fetch pipeline started. Check /pipeline/status for progress.',
        'started_at': datetime.now().isoformat()
    }


def run_pipeline_task():
    """Background task to run the pipeline"""
    global _pipeline_status
    
    _pipeline_status['is_running'] = True
    _pipeline_status['last_run'] = datetime.now().isoformat()
    
    try:
        pipeline = get_pipeline_service()
        result = pipeline.run_full_pipeline(max_products=5)
        _pipeline_status['last_result'] = result
    except Exception as e:
        _pipeline_status['last_result'] = {
            'status': 'failed',
            'error': str(e)
        }
    finally:
        _pipeline_status['is_running'] = False


def _run_risk_prediction_task(overwrite: bool = False):
    """Background task: create fresh Prediction rows from latest satellite NDVI per farm."""
    global _risk_prediction_status
    _risk_prediction_status['is_running'] = True
    _risk_prediction_status['last_run'] = datetime.utcnow().isoformat()

    db = SessionLocal()
    try:
        # Latest satellite record per farm (linked by extra_metadata.farm_id)
        rows = db.execute(
            text(
                """
                SELECT farm_id, ndvi, date
                FROM (
                    SELECT
                        (extra_metadata->>'farm_id')::int AS farm_id,
                        date,
                        COALESCE(
                            NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                            (extra_metadata->>'ndvi_mean')::float
                        ) AS ndvi,
                        ROW_NUMBER() OVER (
                            PARTITION BY (extra_metadata->>'farm_id')::int
                            ORDER BY date DESC, id DESC
                        ) AS rn
                    FROM satellite_images
                    WHERE (extra_metadata->>'farm_id') IS NOT NULL
                ) t
                WHERE rn = 1
                """
            )
        ).fetchall()

        latest_by_farm = {}
        for r in rows:
            if not r or r[0] is None:
                continue
            latest_by_farm[int(r[0])] = {
                "ndvi": r[1],
                "date": r[2],
            }

        if not latest_by_farm:
            _risk_prediction_status['last_result'] = {
                'status': 'no_data',
                'message': 'No satellite images linked to farms found (extra_metadata.farm_id missing).'
            }
            return

        farms = db.query(FarmModel).all()
        now = datetime.utcnow()

        has_any_weather = False
        try:
            has_any_weather = db.execute(text("SELECT 1 FROM weather_records LIMIT 1")).first() is not None
        except Exception:
            has_any_weather = False

        created = 0
        skipped = 0

        for farm in farms:
            sat = latest_by_farm.get(farm.id)
            if not sat:
                skipped += 1
                continue

            ndvi = sat.get('ndvi')
            risk_score = _ndvi_to_risk_score(float(ndvi)) if ndvi is not None else 0.0

            # Optional: if overwrite=True, remove existing latest prediction for farm.
            if overwrite:
                try:
                    db.query(PredictionModel).filter(PredictionModel.farm_id == farm.id).delete()
                except Exception:
                    db.rollback()
                    # If delete fails (FK constraints etc.), fall back to append-only behavior.

            pred = PredictionModel(
                farm_id=farm.id,
                predicted_at=now,
                risk_score=float(risk_score),
                time_to_impact=_get_time_to_impact(float(risk_score)),
            )

            # Store some deterministic explainability fields so the UI can be fully "real".
            try:
                from app.api.v1.endpoints.analytics import (
                    calculate_confidence,
                    calculate_impact_metrics,
                    default_risk_drivers,
                )

                confidence_level, confidence_score = calculate_confidence(
                    float(risk_score),
                    has_satellite_data=True,
                    has_weather_data=has_any_weather,
                )
                pred.confidence_level = confidence_level
                pred.confidence_score = confidence_score
                pred.risk_drivers = default_risk_drivers(float(risk_score))
                pred.impact_metrics = calculate_impact_metrics(float(risk_score), float(farm.area or 1.0))
            except Exception:
                # Best-effort only; prediction itself is still valid.
                pass

            db.add(pred)
            created += 1

        db.commit()

        _risk_prediction_status['last_result'] = {
            'status': 'completed',
            'created_predictions': created,
            'skipped_farms_without_satellite': skipped,
            'predicted_at': now.isoformat(),
        }
    except Exception as e:
        db.rollback()
        _risk_prediction_status['last_result'] = {
            'status': 'failed',
            'error': str(e),
        }
    finally:
        _risk_prediction_status['is_running'] = False
        db.close()


@router.get("/risk-predictions/status")
def get_risk_prediction_status() -> Dict[str, Any]:
    """Get current risk prediction job status."""
    return {
        'is_running': _risk_prediction_status['is_running'],
        'last_run': _risk_prediction_status['last_run'],
        'last_result': _risk_prediction_status['last_result'],
    }


@router.post("/risk-predictions/run")
async def trigger_risk_predictions(background_tasks: BackgroundTasks, overwrite: bool = False) -> Dict[str, Any]:
    """Create fresh risk predictions from latest satellite imagery (background job)."""
    global _risk_prediction_status
    if _risk_prediction_status['is_running']:
        return {
            'status': 'already_running',
            'message': 'Risk prediction job is already running. Please check /pipeline/risk-predictions/status.',
        }

    background_tasks.add_task(_run_risk_prediction_task, overwrite)
    return {
        'status': 'started',
        'message': 'Risk prediction job started. Check /pipeline/risk-predictions/status for progress.',
        'started_at': datetime.utcnow().isoformat(),
        'overwrite': overwrite,
    }


@router.get("/analytics/provinces")
def get_province_analytics() -> List[Dict[str, Any]]:
    """Get analytics aggregated by province"""
    pipeline = get_pipeline_service()
    return pipeline.get_province_analytics()


@router.get("/analytics/districts")
def get_district_analytics(province: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get analytics aggregated by district, optionally filtered by province"""
    pipeline = get_pipeline_service()
    return pipeline.get_district_analytics(province=province)


@router.get("/analytics/farms")
def get_farm_analytics(
    province: Optional[str] = None,
    district: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get individual farm analytics, optionally filtered by province and/or district"""
    pipeline = get_pipeline_service()
    return pipeline.get_farm_analytics(province=province, district=district)


@router.get("/analytics/summary")
def get_analytics_summary() -> Dict[str, Any]:
    """Get comprehensive analytics summary for dashboard"""
    pipeline = get_pipeline_service()
    return pipeline.get_prediction_summary()


@router.get("/analytics/hierarchy")
def get_analytics_hierarchy() -> Dict[str, Any]:
    """Get hierarchical analytics structure (Province > District > Farm count)"""
    pipeline = get_pipeline_service()
    
    provinces = pipeline.get_province_analytics()
    districts = pipeline.get_district_analytics()
    
    hierarchy = {}
    for prov in provinces:
        prov_name = prov['province']
        hierarchy[prov_name] = {
            'info': prov,
            'districts': {}
        }
        
        for dist in districts:
            if dist['province'] == prov_name:
                dist_name = dist['district']
                hierarchy[prov_name]['districts'][dist_name] = dist
    
    return hierarchy


@router.post("/apply-existing-tiles")
def apply_existing_tiles() -> Dict[str, Any]:
    """Apply existing downloaded NDVI tiles to all farms (quick update without download)"""
    pipeline = get_pipeline_service()
    
    from pathlib import Path
    data_dir = Path("data/sentinel2_real")
    
    if not data_dir.exists():
        raise HTTPException(status_code=404, detail="No existing tile data found")
    
    ndvi_files = list(data_dir.glob("ndvi_*.tif"))
    
    if not ndvi_files:
        raise HTTPException(status_code=404, detail="No NDVI files found")
    
    total_updated = 0
    tiles_processed = []
    
    for ndvi_path in ndvi_files:
        tile = ndvi_path.stem.replace('ndvi_', '')
        farm_data = pipeline.extract_ndvi_for_farms(ndvi_path, tile)
        count = pipeline.update_satellite_records(farm_data, tile)
        total_updated += count
        tiles_processed.append({'tile': tile, 'farms_updated': count})
    
    return {
        'status': 'completed',
        'tiles_processed': tiles_processed,
        'total_farms_updated': total_updated
    }


@router.get("/predictions/by-province")
def get_predictions_by_province() -> List[Dict[str, Any]]:
    """Get risk predictions aggregated by province"""
    pipeline = get_pipeline_service()
    provinces = pipeline.get_province_analytics()
    
    predictions = []
    for prov in provinces:
        risk_score = _ndvi_to_risk_score(prov['avg_ndvi'])
        predictions.append({
            'province': prov['province'],
            'farm_count': prov['farm_count'],
            'avg_ndvi': prov['avg_ndvi'],
            'risk_score': risk_score,
            'risk_level': prov['risk_level'],
            'health_status': prov['health_status'],
            'recommendation': _get_recommendation(prov['risk_level']),
            'time_to_impact': _get_time_to_impact(risk_score)
        })
    
    return sorted(predictions, key=lambda x: x['risk_score'], reverse=True)


@router.get("/predictions/by-district")
def get_predictions_by_district(province: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get risk predictions aggregated by district"""
    pipeline = get_pipeline_service()
    districts = pipeline.get_district_analytics(province=province)
    
    predictions = []
    for dist in districts:
        risk_score = _ndvi_to_risk_score(dist['avg_ndvi'])
        predictions.append({
            'province': dist['province'],
            'district': dist['district'],
            'farm_count': dist['farm_count'],
            'avg_ndvi': dist['avg_ndvi'],
            'risk_score': risk_score,
            'risk_level': dist['risk_level'],
            'health_status': dist['health_status'],
            'recommendation': _get_recommendation(dist['risk_level']),
            'time_to_impact': _get_time_to_impact(risk_score)
        })
    
    return sorted(predictions, key=lambda x: x['risk_score'], reverse=True)


@router.get("/predictions/by-farm")
def get_predictions_by_farm(
    province: Optional[str] = None,
    district: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get risk predictions for individual farms"""
    pipeline = get_pipeline_service()
    farms = pipeline.get_farm_analytics(province=province, district=district)
    
    predictions = []
    for farm in farms:
        risk_score = _ndvi_to_risk_score(farm['ndvi'])
        predictions.append({
            'farm_id': farm['id'],
            'farm_name': farm['name'],
            'province': farm['province'],
            'district': farm['district'],
            'area_ha': farm['area_ha'],
            'latitude': farm['latitude'],
            'longitude': farm['longitude'],
            'ndvi': farm['ndvi'],
            'tile': farm['tile'],
            'risk_score': risk_score,
            'risk_level': farm['risk_level'],
            'health_status': farm['health_status'],
            'recommendation': _get_recommendation(farm['risk_level']),
            'time_to_impact': _get_time_to_impact(risk_score),
            'last_update': farm['last_update']
        })
    
    return sorted(predictions, key=lambda x: x['risk_score'], reverse=True)


def _ndvi_to_risk_score(ndvi: float) -> float:
    """Convert NDVI to risk score (0-100, higher = more risk)"""
    if ndvi >= 0.7:
        return 10.0
    elif ndvi >= 0.6:
        return 25.0
    elif ndvi >= 0.5:
        return 40.0
    elif ndvi >= 0.4:
        return 55.0
    elif ndvi >= 0.3:
        return 70.0
    elif ndvi >= 0.2:
        return 85.0
    else:
        return 95.0


def _get_recommendation(risk_level: str) -> str:
    """Get recommendation based on risk level"""
    recommendations = {
        'low': 'Continue regular monitoring. Crops are healthy.',
        'moderate': 'Increase monitoring frequency. Consider preventive measures.',
        'high': 'Immediate attention required. Implement intervention strategies.',
        'critical': 'Emergency action needed. Deploy rapid response measures.'
    }
    return recommendations.get(risk_level, 'Continue monitoring.')


def _get_time_to_impact(risk_score: float) -> str:
    """Estimate time to potential impact"""
    if risk_score >= 80:
        return '< 7 days'
    elif risk_score >= 60:
        return '7-14 days'
    elif risk_score >= 40:
        return '14-30 days'
    else:
        return '> 30 days'
