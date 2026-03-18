"""
API endpoint to get the latest satellite data (NDVI) for each farm
"""
import math
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, date
from pathlib import Path


def _safe_float(v, decimals: int = 4):
    """Return None for NaN/Inf values; otherwise round to `decimals` places."""
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, decimals)
    except (TypeError, ValueError):
        return None

from geoalchemy2.shape import to_shape

from app.db.database import get_db
from app.models.farm import Farm
from app.models.data import SatelliteImage, VegetationHealth, FarmVegetationMetric
from app.services.pipeline_service import get_pipeline_service
from app.core.auth import get_current_active_user, check_farm_access
from app.models.user import User as UserModel

router = APIRouter()

@router.get("/", response_model=List[Dict[str, Any]])
def get_farms_with_satellite_data(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get all farms with their latest satellite NDVI data.
    Returns farm details plus latest NDVI value, date, and image type.
    """
    query = db.query(Farm)
    if current_user.role == "farmer":
        query = query.filter(Farm.owner_id == current_user.id)
    elif current_user.role == "agronomist" and current_user.district:
        query = query.filter(Farm.location.ilike(f"{current_user.district}%"))
        
    farms = query.all()
    result = []

    for farm in farms:
        # Prefer latest metrics row (metrics-only pipeline)
        latest_metric = (
            db.query(FarmVegetationMetric)
            .filter(FarmVegetationMetric.farm_id == farm.id)
            .order_by(desc(FarmVegetationMetric.observation_date))
            .first()
        )

        # Fallback to legacy SatelliteImage if metrics are absent
        latest_image = None
        if latest_metric is None:
            latest_image = (
                db.query(SatelliteImage)
                .filter(SatelliteImage.farm_id == farm.id)
                .filter(SatelliteImage.mean_ndvi.isnot(None))
                .order_by(desc(SatelliteImage.acquisition_date))
                .first()
            )

        farm_data = {
            "id": farm.id,
            "name": farm.name,
            "location": farm.location,
            "area": farm.area,
            "latitude": farm.latitude,
            "longitude": farm.longitude,
            "ndvi": None,
            "ndre": None,
            "ndwi": None,
            "evi": None,
            "savi": None,
            "ndvi_date": None,
            "image_type": None,
            "ndvi_status": "unknown",
            "data_source": "none"
        }

        source_ndvi = None

        if latest_metric:
            ndvi_value = latest_metric.ndvi_mean
            source_ndvi = _safe_float(ndvi_value)
            if ndvi_value is not None:
                farm_data["ndvi"] = _safe_float(ndvi_value)
                farm_data["ndvi_date"] = latest_metric.observation_date.isoformat()
                farm_data["data_source"] = latest_metric.source or "sentinel2"
                farm_data["cloud_cover"] = _safe_float(latest_metric.cloud_cover_percent)
                farm_data["ndre"] = _safe_float(latest_metric.ndre_mean)
                farm_data["ndwi"] = _safe_float(getattr(latest_metric, 'ndwi_mean', None))
                farm_data["evi"] = _safe_float(latest_metric.evi_mean)
                farm_data["savi"] = _safe_float(latest_metric.savi_mean)

        elif latest_image:
            ndvi_value = latest_image.mean_ndvi
            source_ndvi = ndvi_value
            # Fallback: check extra_metadata if mean_ndvi is null
            if ndvi_value is None and latest_image.extra_metadata:
                ndvi_value = latest_image.extra_metadata.get('ndvi_value')

            if ndvi_value is not None:
                farm_data["ndvi"] = _safe_float(ndvi_value)
                farm_data["ndvi_date"] = (
                    latest_image.acquisition_date.isoformat()
                    if latest_image.acquisition_date
                    else latest_image.date.isoformat() if latest_image.date else None
                )
                farm_data["image_type"] = latest_image.image_type
                farm_data["data_source"] = latest_image.source or "unknown"
                farm_data["cloud_cover"] = _safe_float(latest_image.cloud_cover_percent)

                # Include all vegetation indices
                if latest_image.mean_ndre is not None:
                    farm_data["ndre"] = _safe_float(latest_image.mean_ndre)
                if latest_image.mean_ndwi is not None:
                    farm_data["ndwi"] = _safe_float(latest_image.mean_ndwi)
                if latest_image.mean_evi is not None:
                    farm_data["evi"] = _safe_float(latest_image.mean_evi)
                if latest_image.mean_savi is not None:
                    farm_data["savi"] = _safe_float(latest_image.mean_savi)

        # Classify NDVI status
        if source_ndvi is not None:
            if source_ndvi >= 0.6:
                farm_data["ndvi_status"] = "healthy"
            elif source_ndvi >= 0.3:
                farm_data["ndvi_status"] = "moderate"
            else:
                farm_data["ndvi_status"] = "stressed"

        # Enrich with pre-computed health score from VegetationHealth
        latest_veg_health = (
            db.query(VegetationHealth)
            .filter(VegetationHealth.farm_id == farm.id)
            .order_by(desc(VegetationHealth.date))
            .first()
        )
        if latest_veg_health:
            farm_data["health_score"]  = _safe_float(latest_veg_health.health_score)
            farm_data["stress_level"]  = latest_veg_health.stress_level
            farm_data["stress_type"]   = latest_veg_health.stress_type
            # Fall back to stored VegetationHealth indices if SatelliteImage indices are null
            if farm_data["ndvi"] is None and latest_veg_health.ndvi is not None:
                farm_data["ndvi"] = _safe_float(latest_veg_health.ndvi)
            if farm_data["ndre"] is None and latest_veg_health.ndre is not None:
                farm_data["ndre"] = _safe_float(latest_veg_health.ndre)
            if farm_data["ndwi"] is None and latest_veg_health.ndwi is not None:
                farm_data["ndwi"] = _safe_float(latest_veg_health.ndwi)
            if farm_data["evi"] is None and latest_veg_health.evi is not None:
                farm_data["evi"] = _safe_float(latest_veg_health.evi)
            if farm_data["savi"] is None and latest_veg_health.savi is not None:
                farm_data["savi"] = _safe_float(latest_veg_health.savi)
            if farm_data["ndvi_date"] is None and latest_veg_health.date is not None:
                farm_data["ndvi_date"] = latest_veg_health.date.isoformat()

        result.append(farm_data)

    return result


@router.get("/history/{farm_id}")
def get_farm_ndvi_history(
    farm_id: int,
    limit: int = 30,
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get NDVI time series for a specific farm.
    Returns up to `limit` most recent satellite observations.
    Optionally filter by start_date and end_date.
    """
    # Verify farm access
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
        
    check_farm_access(farm, current_user)

    query = (
        db.query(FarmVegetationMetric)
        .filter(FarmVegetationMetric.farm_id == farm_id)
    )

    if start_date:
        query = query.filter(FarmVegetationMetric.observation_date >= date.fromisoformat(start_date))
    if end_date:
        query = query.filter(FarmVegetationMetric.observation_date <= date.fromisoformat(end_date))

    metrics = (
        query.order_by(desc(FarmVegetationMetric.observation_date))
        .limit(limit)
        .all()
    )

    history = []
    for row in metrics:
        history.append({
            "date": row.observation_date.isoformat(),
            "ndvi": _safe_float(row.ndvi_mean),
            "ndre": _safe_float(row.ndre_mean),
            "evi": _safe_float(row.evi_mean),
            "savi": _safe_float(row.savi_mean),
            "ndvi_min": _safe_float(row.ndvi_min),
            "ndvi_max": _safe_float(row.ndvi_max),
            "ndvi_std": _safe_float(row.ndvi_std),
            "cloud_cover": _safe_float(row.cloud_cover_percent),
            "health_score": _safe_float(row.health_score),
        })

    # Return chronologically
    history.reverse()
    return history


@router.get("/metrics/{farm_id}")
def get_farm_metric_series(
    farm_id: int,
    limit: int = 90,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """Return recent vegetation metrics for a farm (NDVI/NDRE/EVI/SAVI)."""

    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    check_farm_access(farm, current_user)

    metrics = (
        db.query(FarmVegetationMetric)
        .filter(FarmVegetationMetric.farm_id == farm_id)
        .order_by(desc(FarmVegetationMetric.observation_date))
        .limit(limit)
        .all()
    )

    history = []
    for row in metrics:
        history.append({
            "date": row.observation_date.isoformat(),
            "ndvi_mean": _safe_float(row.ndvi_mean),
            "ndvi_min": _safe_float(row.ndvi_min),
            "ndvi_max": _safe_float(row.ndvi_max),
            "ndvi_std": _safe_float(row.ndvi_std),
            "ndre_mean": _safe_float(row.ndre_mean),
            "evi_mean": _safe_float(row.evi_mean),
            "savi_mean": _safe_float(row.savi_mean),
            "cloud_cover_percent": _safe_float(row.cloud_cover_percent),
            "health_score": _safe_float(row.health_score),
            "source": row.source,
        })

    history.reverse()
    return {"farm_id": farm_id, "observations": history}


@router.post("/recompute/{farm_id}")
def recompute_farm_satellite(farm_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Recompute (refresh) a farm's satellite NDVI using existing downloaded NDVI tiles."""

    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Ensure we have a point to sample from.
    if getattr(farm, "latitude", None) is None or getattr(farm, "longitude", None) is None:
        if getattr(farm, "boundary", None) is not None:
            centroid = to_shape(farm.boundary).centroid
            farm.latitude = float(centroid.y)
            farm.longitude = float(centroid.x)
            db.commit()
            db.refresh(farm)
        else:
            raise HTTPException(status_code=422, detail="Farm must have either latitude/longitude or a boundary polygon")

    pipeline = get_pipeline_service()
    data_dir = Path("data/sentinel2_real")
    if not data_dir.exists():
        raise HTTPException(status_code=404, detail="No existing tile data found")

    ndvi_files = list(data_dir.glob("ndvi_*.tif"))
    if not ndvi_files:
        raise HTTPException(status_code=404, detail="No NDVI files found")

    total_affected = 0
    tiles_processed: List[Dict[str, Any]] = []

    for ndvi_path in ndvi_files:
        tile = ndvi_path.stem.replace("ndvi_", "")
        farm_data = pipeline.extract_ndvi_for_farms(ndvi_path, tile, farm_id=farm_id)
        affected = pipeline.update_satellite_records(farm_data, tile)
        total_affected += affected
        tiles_processed.append({"tile": tile, "records_affected": affected})

    return {
        "status": "completed",
        "farm_id": farm_id,
        "tiles_processed": tiles_processed,
        "total_records_affected": total_affected,
    }

