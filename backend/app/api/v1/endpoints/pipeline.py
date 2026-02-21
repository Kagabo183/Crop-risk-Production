"""
Pipeline API Endpoints
- Multi-level analytics (Province, District, Farm)
- Manual data fetch trigger
- Pipeline status
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from typing import Dict, List, Any, Optional
from datetime import datetime
from sqlalchemy import text

from app.db.database import get_db
from app.db.database import SessionLocal
from app.services.pipeline_service import get_pipeline_service, PipelineService
from app.models.prediction import Prediction as PredictionModel
from app.models.farm import Farm as FarmModel
from app.api.v1.endpoints.analytics import (
    calculate_confidence,
    calculate_impact_metrics,
    default_risk_drivers,
)
import logging

logger = logging.getLogger(__name__)

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
async def trigger_data_fetch(
    background_tasks: BackgroundTasks,
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
) -> Dict[str, Any]:
    """Manually trigger satellite data fetching for an optional date range."""
    global _pipeline_status

    if _pipeline_status['is_running']:
        return {
            'status': 'already_running',
            'message': 'Pipeline is already running. Please wait for completion.'
        }

    # Run in background
    background_tasks.add_task(run_pipeline_task, start_date, end_date)

    return {
        'status': 'started',
        'message': 'Data fetch pipeline started. Check /pipeline/status for progress.',
        'started_at': datetime.now().isoformat(),
        'date_range': {'start': start_date, 'end': end_date},
    }


def run_pipeline_task(start_date: str = None, end_date: str = None):
    """Background task to run the pipeline"""
    global _pipeline_status

    _pipeline_status['is_running'] = True
    _pipeline_status['last_run'] = datetime.now().isoformat()

    try:
        pipeline = get_pipeline_service()
        result = pipeline.run_full_pipeline(
            max_products=5,
            start_date_str=start_date,
            end_date_str=end_date,
        )
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
        # Latest satellite record per farm - use direct columns + extra_metadata fallback
        rows = db.execute(
            text(
                """
                SELECT farm_id, ndvi, ndre, ndwi, evi, savi, date
                FROM (
                    SELECT
                        COALESCE(
                            farm_id,
                            (extra_metadata->>'farm_id')::int
                        ) AS farm_id,
                        date,
                        COALESCE(
                            mean_ndvi,
                            NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                            (extra_metadata->>'ndvi_mean')::float
                        ) AS ndvi,
                        mean_ndre AS ndre,
                        mean_ndwi AS ndwi,
                        mean_evi AS evi,
                        mean_savi AS savi,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(farm_id, (extra_metadata->>'farm_id')::int)
                            ORDER BY date DESC, id DESC
                        ) AS rn
                    FROM satellite_images
                    WHERE farm_id IS NOT NULL
                       OR (extra_metadata->>'farm_id') IS NOT NULL
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
                "ndre": r[2],
                "ndwi": r[3],
                "evi": r[4],
                "savi": r[5],
                "date": r[6],
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
            ndre = sat.get('ndre')
            ndwi = sat.get('ndwi')
            evi = sat.get('evi')
            savi = sat.get('savi')
            risk_score = _composite_risk_score(ndvi, ndre, ndwi, evi, savi)

            # Optional: if overwrite=True, remove existing latest prediction for farm.
            if overwrite:
                try:
                    db.query(PredictionModel).filter(PredictionModel.farm_id == farm.id).delete()
                except Exception:
                    db.rollback()
                    # If delete fails (FK constraints etc.), fall back to append-only behavior.

            # Calculate ALL intelligence fields
            rs = float(risk_score)
            farm_area = float(farm.area or 1.0)

            # Confidence
            confidence_level, confidence_score = calculate_confidence(
                rs, has_satellite_data=True, has_weather_data=has_any_weather
            )

            # Risk drivers
            risk_drivers = default_risk_drivers(rs)

            # Impact metrics
            impact_metrics = calculate_impact_metrics(rs, farm_area)

            # Disease risk level
            if rs >= 70:
                disease_risk = "high"
            elif rs >= 40:
                disease_risk = "moderate"
            else:
                disease_risk = "low"

            # Yield loss estimate (% of risk translates to yield loss)
            yield_loss = round(rs * 0.4, 1)

            # Risk explanation
            ndvi_val = sat.get('ndvi', 0)
            if rs >= 70:
                risk_explanation = (
                    f"High risk detected for {farm.name or 'farm'}. "
                    f"NDVI={ndvi_val:.3f} indicates significant vegetation stress. "
                    f"Primary drivers: declining vegetation health ({risk_drivers.get('ndvi_trend', 0):.0%}), "
                    f"rainfall deficit ({risk_drivers.get('rainfall_deficit', 0):.0%}). "
                    f"Estimated yield loss: {yield_loss}%. Immediate action recommended."
                )
            elif rs >= 40:
                risk_explanation = (
                    f"Moderate risk for {farm.name or 'farm'}. "
                    f"NDVI={ndvi_val:.3f} shows some vegetation stress. "
                    f"Monitor closely and prepare preventive measures. "
                    f"Estimated yield loss: {yield_loss}%."
                )
            else:
                risk_explanation = (
                    f"Low risk for {farm.name or 'farm'}. "
                    f"NDVI={ndvi_val:.3f} indicates healthy vegetation. "
                    f"Continue routine monitoring."
                )

            # Recommendations based on risk level
            if rs >= 70:
                recommendations = [
                    "Inspect farm immediately for signs of disease or drought",
                    "Apply preventive fungicide if disease symptoms detected",
                    "Check and optimize irrigation system",
                    "Consider emergency fertilizer application for nutrient stress",
                    "Monitor weather forecast for upcoming rainfall"
                ]
            elif rs >= 40:
                recommendations = [
                    "Increase monitoring frequency to every 2-3 days",
                    "Prepare fungicide for preventive application",
                    "Check soil moisture levels and adjust irrigation",
                    "Review crop nutrient requirements for growth stage"
                ]
            else:
                recommendations = [
                    "Continue routine monitoring schedule",
                    "Maintain current irrigation and fertilization plan",
                    "Scout for early signs of pest or disease"
                ]

            pred = PredictionModel(
                farm_id=farm.id,
                predicted_at=now,
                risk_score=rs,
                yield_loss=yield_loss,
                disease_risk=disease_risk,
                time_to_impact=_get_time_to_impact(rs),
                confidence_level=confidence_level,
                confidence_score=confidence_score,
                risk_drivers=risk_drivers,
                risk_explanation=risk_explanation,
                recommendations=recommendations,
                impact_metrics=impact_metrics,
            )

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


@router.post("/risk-predictions/backfill")
def backfill_null_predictions(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Backfill existing predictions that have null intelligence fields."""
    null_preds = db.query(PredictionModel).filter(
        PredictionModel.confidence_level.is_(None)
    ).all()

    if not null_preds:
        return {"status": "no_nulls", "message": "No predictions with null fields found"}

    # Check weather availability
    has_any_weather = False
    try:
        has_any_weather = db.execute(text("SELECT 1 FROM weather_records LIMIT 1")).first() is not None
    except Exception:
        pass

    # Load farms for area info
    farms_map = {}
    farms = db.query(FarmModel).all()
    for f in farms:
        farms_map[f.id] = f

    updated = 0
    for pred in null_preds:
        rs = float(pred.risk_score or 0)
        farm = farms_map.get(pred.farm_id)
        farm_area = float(farm.area or 1.0) if farm else 1.0
        farm_name = farm.name if farm else "farm"

        confidence_level, confidence_score = calculate_confidence(
            rs, has_satellite_data=True, has_weather_data=has_any_weather
        )

        pred.confidence_level = confidence_level
        pred.confidence_score = confidence_score
        pred.risk_drivers = default_risk_drivers(rs)
        pred.impact_metrics = calculate_impact_metrics(rs, farm_area)
        pred.yield_loss = round(rs * 0.4, 1)
        pred.disease_risk = "high" if rs >= 70 else "moderate" if rs >= 40 else "low"
        pred.time_to_impact = pred.time_to_impact or _get_time_to_impact(rs)

        if rs >= 70:
            pred.risk_explanation = (
                f"High risk detected for {farm_name}. "
                f"Significant vegetation stress identified. "
                f"Estimated yield loss: {pred.yield_loss}%. Immediate action recommended."
            )
            pred.recommendations = [
                "Inspect farm immediately for signs of disease or drought",
                "Apply preventive fungicide if disease symptoms detected",
                "Check and optimize irrigation system",
                "Consider emergency fertilizer application for nutrient stress",
                "Monitor weather forecast for upcoming rainfall"
            ]
        elif rs >= 40:
            pred.risk_explanation = (
                f"Moderate risk for {farm_name}. "
                f"Some vegetation stress detected. "
                f"Monitor closely and prepare preventive measures. "
                f"Estimated yield loss: {pred.yield_loss}%."
            )
            pred.recommendations = [
                "Increase monitoring frequency to every 2-3 days",
                "Prepare fungicide for preventive application",
                "Check soil moisture levels and adjust irrigation",
                "Review crop nutrient requirements for growth stage"
            ]
        else:
            pred.risk_explanation = (
                f"Low risk for {farm_name}. "
                f"Healthy vegetation detected. "
                f"Continue routine monitoring."
            )
            pred.recommendations = [
                "Continue routine monitoring schedule",
                "Maintain current irrigation and fertilization plan",
                "Scout for early signs of pest or disease"
            ]

        updated += 1

    db.commit()
    return {
        "status": "completed",
        "updated_predictions": updated,
        "message": f"Successfully backfilled {updated} predictions with full intelligence fields"
    }


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


def _index_to_risk(value, thresholds):
    """Convert a vegetation index value to a risk score using thresholds.
    thresholds: list of (min_value, risk_score) pairs, sorted by min_value desc.
    """
    if value is None:
        return None
    for min_val, risk in thresholds:
        if value >= min_val:
            return risk
    return thresholds[-1][1] if thresholds else 95.0


def _composite_risk_score(ndvi, ndre, ndwi, evi, savi) -> float:
    """Calculate composite risk score from ALL vegetation indices.

    Weights: NDVI (30%), NDRE (20%), NDWI (20%), EVI (15%), SAVI (15%)
    Each index is converted to a risk score (0-100), then weighted.
    """
    scores = []
    weights = []

    # NDVI (30%) - Primary vegetation health
    ndvi_risk = _index_to_risk(ndvi, [
        (0.7, 10), (0.6, 25), (0.5, 40), (0.4, 55), (0.3, 70), (0.2, 85), (0.0, 95)
    ])
    if ndvi_risk is not None:
        scores.append(ndvi_risk)
        weights.append(0.30)

    # NDRE (20%) - Chlorophyll/nitrogen
    ndre_risk = _index_to_risk(ndre, [
        (0.5, 10), (0.4, 30), (0.3, 50), (0.2, 70), (0.0, 90)
    ])
    if ndre_risk is not None:
        scores.append(ndre_risk)
        weights.append(0.20)

    # NDWI (20%) - Water content
    ndwi_risk = _index_to_risk(ndwi, [
        (0.3, 10), (0.2, 30), (0.1, 50), (0.0, 70), (-1.0, 90)
    ])
    if ndwi_risk is not None:
        scores.append(ndwi_risk)
        weights.append(0.20)

    # EVI (15%) - Enhanced vegetation
    evi_risk = _index_to_risk(evi, [
        (0.6, 10), (0.4, 30), (0.3, 50), (0.2, 70), (0.0, 90)
    ])
    if evi_risk is not None:
        scores.append(evi_risk)
        weights.append(0.15)

    # SAVI (15%) - Soil-adjusted
    savi_risk = _index_to_risk(savi, [
        (0.5, 10), (0.4, 30), (0.3, 50), (0.2, 70), (0.0, 90)
    ])
    if savi_risk is not None:
        scores.append(savi_risk)
        weights.append(0.15)

    if not scores:
        return 50.0  # Default medium risk if no data

    # Normalize weights and calculate
    total_weight = sum(weights)
    composite = sum(s * w for s, w in zip(scores, weights)) / total_weight

    return round(composite, 1)


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
