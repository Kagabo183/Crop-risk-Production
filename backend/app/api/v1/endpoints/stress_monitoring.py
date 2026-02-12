"""
API endpoints for satellite stress monitoring
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from app.db.database import get_db
from app.services.satellite_service import SatelliteDataService
from app.services.stress_detection_service import StressDetectionService
from app.models.data import VegetationHealth, SatelliteImage
from app.models.farm import Farm
from app.tasks.satellite_tasks import process_single_farm
from app.core.auth import get_current_active_user, check_farm_access
from app.models.user import User as UserModel
from pydantic import BaseModel

router = APIRouter()


# Pydantic schemas
class VegetationHealthResponse(BaseModel):
    date: str
    ndvi: Optional[float]
    ndwi: Optional[float]
    evi: Optional[float]
    health_score: Optional[float]
    stress_level: Optional[str]
    stress_type: Optional[str]
    
    class Config:
        from_attributes = True


class StressAssessmentResponse(BaseModel):
    health_score: float
    stress_score: float
    stress_level: str
    primary_stress: str
    message: str
    stress_breakdown: dict


class TriggerDownloadRequest(BaseModel):
    farm_id: int
    days_back: Optional[int] = 30


@router.get("/health/{farm_id}", response_model=List[VegetationHealthResponse])
def get_vegetation_health_timeseries(
    farm_id: int,
    days_back: int = 90,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get vegetation health time series for a farm
    
    Args:
        farm_id: Farm ID
        days_back: Number of days to retrieve (default: 90)
    
    Returns:
        List of vegetation health records
    """
    # Verify farm exists
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    # Get vegetation health data
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days_back)
    
    health_records = db.query(VegetationHealth).filter(
        VegetationHealth.farm_id == farm_id,
        VegetationHealth.date >= start_date,
        VegetationHealth.date <= end_date
    ).order_by(VegetationHealth.date.asc()).all()
    
    return [
        VegetationHealthResponse(
            date=record.date.isoformat(),
            ndvi=record.ndvi,
            ndwi=record.ndwi,
            evi=record.evi,
            health_score=record.health_score,
            stress_level=record.stress_level,
            stress_type=record.stress_type
        )
        for record in health_records
    ]


@router.get("/stress-assessment/{farm_id}", response_model=StressAssessmentResponse)
def get_stress_assessment(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get current stress assessment for a farm
    
    Args:
        farm_id: Farm ID
    
    Returns:
        Comprehensive stress assessment
    """
    # Verify farm exists
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    # Get stress assessment
    stress_service = StressDetectionService()
    assessment = stress_service.calculate_composite_health_score(db, farm_id)
    
    return StressAssessmentResponse(**assessment)


@router.get("/indices/{farm_id}")
def get_latest_vegetation_indices(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get latest vegetation indices for a farm
    
    Args:
        farm_id: Farm ID
    
    Returns:
        Latest satellite image with all vegetation indices
    """
    # Verify farm exists
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    # Get latest satellite image
    latest_image = db.query(SatelliteImage).filter(
        SatelliteImage.farm_id == farm_id
    ).order_by(SatelliteImage.acquisition_date.desc()).first()
    
    if not latest_image:
        raise HTTPException(status_code=404, detail="No satellite data available for this farm")
    
    return {
        "farm_id": farm_id,
        "acquisition_date": latest_image.acquisition_date.isoformat() if latest_image.acquisition_date else None,
        "source": latest_image.source,
        "cloud_cover_percent": latest_image.cloud_cover_percent,
        "indices": {
            "ndvi": latest_image.mean_ndvi,
            "ndre": latest_image.mean_ndre,
            "ndwi": latest_image.mean_ndwi,
            "evi": latest_image.mean_evi,
            "savi": latest_image.mean_savi
        }
    }


@router.post("/trigger-download")
def trigger_satellite_download(
    request: TriggerDownloadRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Manually trigger satellite data download for a farm
    
    Args:
        request: Download request with farm_id and days_back
    
    Returns:
        Task status
    """
    # Verify farm exists
    farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    if not farm.latitude or not farm.longitude:
        raise HTTPException(status_code=400, detail="Farm has no coordinates")
    
    # Trigger background task
    task = process_single_farm.delay(request.farm_id, request.days_back)
    
    return {
        "task_id": task.id,
        "status": "processing",
        "farm_id": request.farm_id,
        "message": f"Satellite data download initiated for farm {request.farm_id}"
    }


@router.get("/stress-zones/{farm_id}")
def get_stress_zones(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get stress zones within a farm (GeoJSON format)
    
    Args:
        farm_id: Farm ID
    
    Returns:
        GeoJSON with stress zones
    """
    # Verify farm exists
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    # Get stress assessment
    stress_service = StressDetectionService()
    assessment = stress_service.calculate_composite_health_score(db, farm_id)
    
    # For now, return the whole farm as a single zone
    # In a more advanced implementation, this would divide the farm into sub-zones
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [farm.longitude, farm.latitude]
                },
                "properties": {
                    "farm_id": farm_id,
                    "farm_name": farm.name,
                    "stress_level": assessment['stress_level'],
                    "health_score": assessment['health_score'],
                    "primary_stress": assessment['primary_stress'],
                    "message": assessment['message']
                }
            }
        ]
    }


@router.get("/drought-assessment/{farm_id}")
def get_drought_assessment(
    farm_id: int,
    days_back: int = 30,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get detailed drought stress assessment
    
    Args:
        farm_id: Farm ID
        days_back: Number of days to analyze
    
    Returns:
        Drought assessment details
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    stress_service = StressDetectionService()
    drought = stress_service.detect_drought_stress(db, farm_id, days_back)
    
    return drought


@router.get("/water-stress/{farm_id}")
def get_water_stress_assessment(
    farm_id: int,
    days_back: int = 14,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get detailed water stress assessment
    
    Args:
        farm_id: Farm ID
        days_back: Number of days to analyze
    
    Returns:
        Water stress assessment details
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    stress_service = StressDetectionService()
    water_stress = stress_service.detect_water_stress(db, farm_id, days_back)
    
    return water_stress


@router.get("/heat-stress/{farm_id}")
def get_heat_stress_assessment(
    farm_id: int,
    days_back: int = 14,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get detailed heat stress assessment
    
    Args:
        farm_id: Farm ID
        days_back: Number of days to analyze
    
    Returns:
        Heat stress assessment details
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
        
    check_farm_access(farm, current_user)
    
    stress_service = StressDetectionService()
    heat_stress = stress_service.detect_heat_stress(db, farm_id, days_back)
    
    return heat_stress


@router.get("/nutrient-assessment/{farm_id}")
def get_nutrient_assessment(
    farm_id: int,
    days_back: int = 30,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get detailed nutrient deficiency assessment
    
    Args:
        farm_id: Farm ID
        days_back: Number of days to analyze
    
    Returns:
        Nutrient deficiency assessment details
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    check_farm_access(farm, current_user)
    
    stress_service = StressDetectionService()
    nutrient = stress_service.detect_nutrient_deficiency(db, farm_id, days_back)
    
    return nutrient
