"""
API endpoint to get the latest satellite data (NDVI) for each farm
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, date
from pathlib import Path
import random

from geoalchemy2.shape import to_shape

from app.db.database import get_db
from app.models.farm import Farm
from app.models.data import SatelliteImage
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
        # Get latest satellite image for this farm using the farm_id column
        # Prioritize images with non-NULL NDVI values
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
            "data_source": "simulated"
        }

        if latest_image:
            ndvi_value = latest_image.mean_ndvi
            # Fallback: check extra_metadata if mean_ndvi is null
            if ndvi_value is None and latest_image.extra_metadata:
                ndvi_value = latest_image.extra_metadata.get('ndvi_value')

            if ndvi_value is not None:
                farm_data["ndvi"] = round(ndvi_value, 4)
                farm_data["ndvi_date"] = (
                    latest_image.acquisition_date.isoformat()
                    if latest_image.acquisition_date
                    else latest_image.date.isoformat() if latest_image.date else None
                )
                farm_data["image_type"] = latest_image.image_type
                farm_data["data_source"] = latest_image.source or "simulated"
                farm_data["cloud_cover"] = latest_image.cloud_cover_percent

                # Include all vegetation indices
                if latest_image.mean_ndre is not None:
                    farm_data["ndre"] = round(latest_image.mean_ndre, 4)
                if latest_image.mean_ndwi is not None:
                    farm_data["ndwi"] = round(latest_image.mean_ndwi, 4)
                if latest_image.mean_evi is not None:
                    farm_data["evi"] = round(latest_image.mean_evi, 4)
                if latest_image.mean_savi is not None:
                    farm_data["savi"] = round(latest_image.mean_savi, 4)

                # Classify NDVI status
                if ndvi_value >= 0.6:
                    farm_data["ndvi_status"] = "healthy"
                elif ndvi_value >= 0.3:
                    farm_data["ndvi_status"] = "moderate"
                else:
                    farm_data["ndvi_status"] = "stressed"

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
        db.query(SatelliteImage)
        .filter(SatelliteImage.farm_id == farm_id)
        .filter(SatelliteImage.mean_ndvi.isnot(None))
    )

    if start_date:
        query = query.filter(SatelliteImage.date >= date.fromisoformat(start_date))
    if end_date:
        query = query.filter(SatelliteImage.date <= date.fromisoformat(end_date))

    images = (
        query.order_by(desc(SatelliteImage.acquisition_date))
        .limit(limit)
        .all()
    )

    history = []
    for img in images:
        history.append({
            "date": (
                img.acquisition_date.isoformat()
                if img.acquisition_date
                else img.date.isoformat() if img.date else None
            ),
            "ndvi": round(img.mean_ndvi, 4),
            "ndre": round(img.mean_ndre, 4) if img.mean_ndre else None,
            "ndwi": round(img.mean_ndwi, 4) if img.mean_ndwi else None,
            "evi": round(img.mean_evi, 4) if img.mean_evi else None,
            "image_type": img.image_type,
            "cloud_cover": img.cloud_cover_percent,
        })

    # Return chronologically
    history.reverse()
    return history


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

@router.post("/seed")
def seed_satellite_data(db: Session = Depends(get_db)):
    """Generate simulated satellite data for demo purposes"""
    farms = db.query(Farm).all()
    count = 0
    
    # Clear existing simulated data first to avoid duplicates
    db.query(SatelliteImage).filter(SatelliteImage.extra_metadata["source"].astext == "simulated").delete(synchronize_session=False)
    
    for farm in farms:
        # Generate 6 months of data
        start_date = datetime.now() - timedelta(days=180)
        current_date = start_date
        
        # Base healthy trend (random per farm)
        base_ndvi = random.uniform(0.5, 0.7)
        
        while current_date <= datetime.now():
            days_passed = (current_date - start_date).days
            # Slight seasonal curve (sine-like)
            import math
            seasonal = 0.1 * math.sin(days_passed / 30)
            
            date_ndvi = base_ndvi + seasonal + random.uniform(-0.05, 0.05)
            date_ndvi = max(0.1, min(0.9, date_ndvi))
            
            # 10% chance of 'cloudy' day (bad data or skips)
            cloud_cover = random.uniform(0, 100)
            if cloud_cover > 80:
                # cloudy observation
                date_ndvi = date_ndvi * 0.6 # drop due to clouds?
            
            sim_image = SatelliteImage(
                farm_id=farm.id,
                date=current_date.date(),
                acquisition_date=current_date,
                mean_ndvi=float(round(date_ndvi, 4)),
                cloud_cover_percent=cloud_cover,
                image_type="Synthesized",
                source="simulated",
                extra_metadata={
                    "source": "simulated",
                    "ndvi_value": float(round(date_ndvi, 4)),
                    "simulated": True
                }
            )
            db.add(sim_image)
            count += 1
            current_date += timedelta(days=random.randint(5, 10))
            
    db.commit()
    return {"message": f"Generated {count} simulated records for {len(farms)} farms"}



