"""
API endpoint to get the latest satellite data (NDVI) for each farm
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Dict, Any
from datetime import datetime
from pathlib import Path

from geoalchemy2.shape import to_shape

from app.db.database import get_db
from app.models.farm import Farm
from app.models.data import SatelliteImage
from app.services.pipeline_service import get_pipeline_service

router = APIRouter()

@router.get("/", response_model=List[Dict[str, Any]])
def get_farms_with_satellite_data(db: Session = Depends(get_db)):
    """
    Get all farms with their latest satellite NDVI data.
    Returns farm details plus latest NDVI value, date, and image type.
    """
    farms = db.query(Farm).all()
    result = []
    
    for farm in farms:
        # Get latest satellite image for this farm (from extra_metadata farm_id)
        # Using Python filtering instead of JSON query for broader compatibility
        all_images = (
            db.query(SatelliteImage)
            .order_by(desc(SatelliteImage.date))
            .all()
        )
        
        latest_image = None
        for img in all_images:
            if img.extra_metadata and img.extra_metadata.get('farm_id') == farm.id:
                latest_image = img
                break
        
        farm_data = {
            "id": farm.id,
            "name": farm.name,
            "location": farm.location,
            "area": farm.area,
            "latitude": getattr(farm, 'latitude', None),
            "longitude": getattr(farm, 'longitude', None),
            "ndvi": None,
            "ndvi_date": None,
            "image_type": None,
            "ndvi_status": "unknown",
            "data_source": "simulated"  # Default to simulated
        }
        
        if latest_image and latest_image.extra_metadata:
            ndvi_value = latest_image.extra_metadata.get('ndvi_value')
            if ndvi_value is not None:
                farm_data["ndvi"] = round(ndvi_value, 4)
                farm_data["ndvi_date"] = latest_image.date.isoformat() if latest_image.date else None
                farm_data["image_type"] = latest_image.image_type
                
                # Check if real sentinel-2 data
                source = latest_image.extra_metadata.get('source', 'simulated')
                farm_data["data_source"] = "real" if source == "sentinel2_real" else "simulated"
                farm_data["tile"] = latest_image.extra_metadata.get('tile')
                farm_data["cloud_cover"] = latest_image.extra_metadata.get('cloud_cover')
                
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
def get_farm_ndvi_history(farm_id: int, limit: int = 30, db: Session = Depends(get_db)):
    """
    Get NDVI time series for a specific farm.
    Returns up to `limit` most recent satellite observations.
    """
    # Get all images and filter by farm_id in Python
    all_images = (
        db.query(SatelliteImage)
        .order_by(desc(SatelliteImage.date))
        .all()
    )
    
    images = [img for img in all_images if img.extra_metadata and img.extra_metadata.get('farm_id') == farm_id][:limit]
    
    history = []
    for img in images:
        if img.extra_metadata and 'ndvi_value' in img.extra_metadata:
            history.append({
                "date": img.date.isoformat() if img.date else None,
                "ndvi": round(img.extra_metadata['ndvi_value'], 4),
                "image_type": img.image_type,
                "cloud_coverage": img.extra_metadata.get('cloud_coverage', 0)
            })
    
    # Sort chronologically
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
