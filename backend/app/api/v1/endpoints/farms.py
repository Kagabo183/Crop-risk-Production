from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from pydantic import BaseModel, ConfigDict, Field
from geoalchemy2.shape import to_shape

from app.db.database import get_db
from app.models.farm import Farm as FarmModel
from app.models.user import User as UserModel
from app.core.auth import get_current_active_user, require_farmer_or_above
from app.tasks.satellite_tasks import process_single_farm
from app.tasks.auto_crop_risk_tasks import analyze_single_farm_risk
from app.utils.rwanda_boundary import (
    validate_point_in_rwanda,
    validate_boundary_in_rwanda,
    detect_province_from_coordinates,
    detect_location_details,
    calculate_area_hectares
)

router = APIRouter()

# ── Growth stage definitions (days after planting) ──
GROWTH_STAGES = {
    "maize":   [("germination",7),("seedling",21),("vegetative",50),("flowering",70),("grain_fill",95),("maturity",120)],
    "potato":  [("germination",14),("seedling",28),("vegetative",55),("flowering",70),("tuber_fill",90),("maturity",110)],
    "rice":    [("germination",10),("seedling",25),("vegetative",55),("flowering",75),("grain_fill",100),("maturity",120)],
    "cassava": [("germination",14),("establishment",42),("vegetative",120),("tuber_fill",240),("maturity",300)],
    "beans":   [("germination",7),("seedling",20),("vegetative",35),("flowering",45),("pod_fill",60),("maturity",75)],
    "banana":  [("vegetative",60),("flowering",210),("fruiting",300),("maturity",365)],
    "coffee":  [("seedling",60),("vegetative",180),("flowering",240),("fruiting",300),("maturity",365)],
    "tea":     [("seedling",60),("vegetative",180),("harvest_ready",365)],
    "sorghum": [("germination",7),("seedling",21),("vegetative",45),("flowering",65),("grain_fill",85),("maturity",110)],
    "wheat":   [("germination",7),("seedling",21),("vegetative",45),("flowering",60),("grain_fill",80),("maturity",100)],
}
DEFAULT_STAGES = [("germination",10),("seedling",25),("vegetative",50),("flowering",70),("fruiting",90),("maturity",120)]


def compute_growth_stage(crop_type: Optional[str], planting_date: Optional[date]) -> dict:
    """Compute current growth stage from crop type and planting date."""
    if not planting_date:
        return {"stage": "unknown", "days_after_planting": None, "progress_pct": None}

    days = (date.today() - planting_date).days
    if days < 0:
        return {"stage": "not_planted", "days_after_planting": days, "progress_pct": 0}

    crop = (crop_type or "").lower().split(",")[0].strip()
    stages = GROWTH_STAGES.get(crop, DEFAULT_STAGES)

    current_stage = stages[-1][0]  # default to last stage
    for stage_name, stage_day in stages:
        if days <= stage_day:
            current_stage = stage_name
            break

    total_days = stages[-1][1]
    progress = min(100, round(days / total_days * 100))

    return {"stage": current_stage, "days_after_planting": days, "progress_pct": progress}


# ── Pydantic schemas ──

class FarmOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: Optional[str] = None
    province: Optional[str] = None
    crop_type: Optional[str] = None
    area: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    planting_date: Optional[date] = None
    season: Optional[str] = None
    growth_stage: Optional[dict] = None
    owner_id: Optional[int] = None
    has_boundary: bool = False
    detected_crop:          Optional[str]   = None
    crop_confidence:        Optional[float] = None
    detected_growth_stage:  Optional[str]   = None
    last_satellite_date:    Optional[date]  = None
    crop_source:            Optional[str]   = None
    boundary_geojson: Optional[dict] = None


class FarmCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    province: Optional[str] = Field(None, max_length=50)
    crop_type: Optional[str] = Field(None, max_length=255, description="Comma-separated crop types, e.g. 'potato, maize'")
    area: Optional[float] = Field(None, ge=0, description="Area in hectares")
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    planting_date: Optional[date] = None
    season: Optional[str] = Field(None, max_length=50)
    boundary: Optional[dict] = Field(None, description="GeoJSON geometry (Polygon) for farm boundary")


class FarmUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    province: Optional[str] = Field(None, max_length=50)
    crop_type: Optional[str] = Field(None, max_length=255)
    area: Optional[float] = Field(None, ge=0)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    planting_date: Optional[date] = None
    season: Optional[str] = Field(None, max_length=50)
    boundary: Optional[dict] = Field(None, description="GeoJSON geometry (Polygon) for farm boundary")


class BoundarySaveRequest(BaseModel):
    boundary_geojson: dict = Field(..., description="GeoJSON geometry (Polygon)")


def _farm_to_out(farm: FarmModel) -> dict:
    """Convert ORM Farm to dict with computed growth_stage."""
    boundary_geojson = None
    if getattr(farm, "boundary", None) is not None:
        try:
            boundary_geojson = to_shape(farm.boundary).__geo_interface__
        except Exception:
            boundary_geojson = None

    return {
        "id": farm.id,
        "name": farm.name,
        "location": farm.location,
        "province": farm.province,
        "crop_type": farm.crop_type,
        "area": farm.area,
        "latitude": farm.latitude,
        "longitude": farm.longitude,
        "planting_date": farm.planting_date,
        "season": farm.season,
        "growth_stage": compute_growth_stage(farm.crop_type, farm.planting_date),
        "owner_id": farm.owner_id,
        "has_boundary": farm.boundary is not None,
        "boundary_geojson": boundary_geojson,
        "detected_crop":          farm.detected_crop,
        "crop_confidence":        farm.crop_confidence,
        "detected_growth_stage":  farm.detected_growth_stage,
        "last_satellite_date":    farm.last_satellite_date,
        "crop_source":            "ai" if farm.detected_crop else ("manual" if farm.crop_type else None),
    }


@router.get("/", response_model=List[FarmOut])
def get_farms(
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    List farms by role:
      - Admin: all farms
      - Agronomist: farms in their district only
      - Farmer: only their own farms
      - Viewer: all farms (read-only)
    """
    query = db.query(FarmModel)
    if current_user.role == "farmer":
        query = query.filter(FarmModel.owner_id == current_user.id)
    elif current_user.role == "agronomist" and current_user.district:
        # Match both "District" and "District - Sector" location formats
        query = query.filter(FarmModel.location.ilike(f"{current_user.district}%"))
    farms = query.offset(skip).limit(limit).all()
    return [_farm_to_out(f) for f in farms]


@router.post("/", response_model=FarmOut)
def create_farm(
    farm: FarmCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Register a new farm with Rwanda boundary validation.

    - Auto-assigns owner_id to the current user
    - Validates coordinates/boundary are within Rwanda
    - Auto-detects province if not provided
    - Auto-triggers satellite data fetch
    """
    from geoalchemy2.shape import from_shape
    from shapely.geometry import shape

    # Validate coordinates are in Rwanda
    if farm.latitude and farm.longitude:
        is_valid, error_msg = validate_point_in_rwanda(farm.latitude, farm.longitude)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Farm location must be within Rwanda. {error_msg}"
            )

        # Auto-detect province if not provided
        if not farm.province:
            detected_province = detect_province_from_coordinates(farm.latitude, farm.longitude)
            if detected_province:
                farm.province = detected_province

    # Validate boundary if provided
    boundary_wkb = None
    if farm.boundary:
        is_valid, error_msg = validate_boundary_in_rwanda(farm.boundary)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Farm boundary must be within Rwanda. {error_msg}"
            )

        # Convert GeoJSON to WKB for database
        try:
            shapely_geom = shape(farm.boundary)
            boundary_wkb = from_shape(shapely_geom, srid=4326)

            # Auto-calculate area from boundary if not provided
            if not farm.area:
                farm.area = calculate_area_hectares(farm.boundary)

            # Auto-derive centroid coordinates if missing
            if not farm.latitude or not farm.longitude:
                centroid = shapely_geom.centroid
                farm.latitude = centroid.y
                farm.longitude = centroid.x
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid boundary geometry: {str(e)}"
            )

    # Create farm
    db_farm = FarmModel(
        name=farm.name,
        location=farm.location,
        province=farm.province,
        crop_type=farm.crop_type,
        area=farm.area,
        latitude=farm.latitude,
        longitude=farm.longitude,
        planting_date=farm.planting_date,
        season=farm.season,
        boundary=boundary_wkb,
        owner_id=current_user.id,
    )
    db.add(db_farm)
    db.commit()
    db.refresh(db_farm)

    # Auto-trigger satellite data fetch if farm has coordinates
    if db_farm.latitude and db_farm.longitude:
        try:
            process_single_farm.delay(db_farm.id, 30)
        except Exception:
            pass  # Don't fail farm creation if Celery is unavailable
        # Auto-trigger crop risk analysis
        try:
            analyze_single_farm_risk.delay(db_farm.id)
        except Exception:
            pass

    return _farm_to_out(db_farm)


@router.put("/{farm_id}", response_model=FarmOut)
def update_farm(
    farm_id: int, farm: FarmUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Update an existing farm with Rwanda boundary validation. Farmers can only update their own farms."""
    from geoalchemy2.shape import from_shape
    from shapely.geometry import shape

    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    update_data = farm.model_dump(exclude_unset=True)

    # Validate coordinates if being updated
    if 'latitude' in update_data and 'longitude' in update_data:
        is_valid, error_msg = validate_point_in_rwanda(update_data['latitude'], update_data['longitude'])
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Farm location must be within Rwanda. {error_msg}"
            )

    # Validate and convert boundary if being updated
    if 'boundary' in update_data and update_data['boundary']:
        is_valid, error_msg = validate_boundary_in_rwanda(update_data['boundary'])
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Farm boundary must be within Rwanda. {error_msg}"
            )

        try:
            # Store original GeoJSON before conversion for area calculation
            boundary_geojson = update_data['boundary']
            shapely_geom = shape(boundary_geojson)
            update_data['boundary'] = from_shape(shapely_geom, srid=4326)

            # Auto-update area from boundary using geodesic calculation
            if 'area' not in update_data:
                update_data['area'] = calculate_area_hectares(boundary_geojson)

            # Auto-derive centroid coordinates if missing or if coordinates not supplied
            if ('latitude' not in update_data or 'longitude' not in update_data) and shapely_geom.is_valid:
                centroid = shapely_geom.centroid
                update_data.setdefault('latitude', centroid.y)
                update_data.setdefault('longitude', centroid.x)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid boundary geometry: {str(e)}"
            )

    coords_changed = 'latitude' in update_data or 'longitude' in update_data or 'boundary' in update_data
    for key, value in update_data.items():
        setattr(db_farm, key, value)

    db.commit()
    db.refresh(db_farm)

    # Re-fetch satellite data if coordinates changed
    if coords_changed and db_farm.latitude and db_farm.longitude:
        try:
            process_single_farm.delay(db_farm.id, 30)
        except Exception:
            pass
        # Auto-trigger crop risk analysis
        try:
            analyze_single_farm_risk.delay(db_farm.id)
        except Exception:
            pass

    return _farm_to_out(db_farm)


@router.delete("/{farm_id}")
def delete_farm(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Delete a farm. Farmers can only delete their own farms."""
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    db.delete(db_farm)
    db.commit()
    return {"status": "deleted", "farm_id": farm_id}


@router.post("/{farm_id}/auto-detect-boundary")
def auto_detect_farm_boundary(
    farm_id: int,
    buffer_meters: int = 200,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Automatically detect farm boundary from satellite imagery using Dynamic World land cover.

    This uses Google's Dynamic World dataset to identify crop areas and exclude forests/buildings.

    Args:
        farm_id: Farm ID
        buffer_meters: Search radius around farm center point (default 200m)

    Returns:
        Detected boundary as GeoJSON polygon with area and confidence
    """
    from app.services.satellite_service import SatelliteDataService
    from geoalchemy2.shape import from_shape
    from shapely.geometry import shape
    import json

    # Get farm
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Check permissions
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    # Check if farm has coordinates
    if not db_farm.latitude or not db_farm.longitude:
        raise HTTPException(
            status_code=400,
            detail="Farm must have coordinates (latitude/longitude) to auto-detect boundary"
        )

    # Require GEE to be available — surface a clear 503 instead of a vague 500
    from app.core import gee_manager
    if not gee_manager.is_initialized():
        raise HTTPException(
            status_code=503,
            detail=(
                "Satellite boundary detection is unavailable: Google Earth Engine is not "
                "configured. Set GEE_SERVICE_ACCOUNT_EMAIL, GEE_PRIVATE_KEY_PATH, and "
                "GEE_PROJECT environment variables and restart the server."
            ),
        )

    # Extract boundary using Dynamic World
    satellite_service = SatelliteDataService()
    result = satellite_service.extract_farm_boundary(
        lat=db_farm.latitude,
        lon=db_farm.longitude,
        buffer_meters=buffer_meters
    )

    if not result['success']:
        raise HTTPException(
            status_code=422,
            detail=result.get('error', 'Failed to detect farm boundary')
        )

    # Optionally save to database (for now just return it)
    # User can review and confirm before saving
    return {
        "success": True,
        "farm_id": farm_id,
        "boundary": result['boundary'],  # GeoJSON polygon
        "area_ha": result['area_ha'],
        "confidence": result['confidence'],
        "land_cover": result['land_cover'],
        "message": f"Farm boundary detected: {result['area_ha']:.2f} hectares (confidence: {result['confidence']:.0%})"
    }


@router.post("/{farm_id}/save-boundary")
def save_farm_boundary(
    farm_id: int,
    request: BoundarySaveRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Save a farm boundary polygon (from auto-detection or manual drawing).

    Args:
        farm_id: Farm ID
        request: Request body containing boundary_geojson

    Returns:
        Updated farm with boundary
    """
    from geoalchemy2.shape import from_shape
    from shapely.geometry import shape

    # Get farm
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Check permissions
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    try:
        boundary_geojson = request.boundary_geojson

        # Convert GeoJSON to Shapely geometry
        shapely_geom = shape(boundary_geojson)

        # Convert to GeoAlchemy2 geometry (WKT format with SRID)
        db_farm.boundary = from_shape(shapely_geom, srid=4326)

        # Update area using geodesic calculation (accurate on Earth's surface)
        db_farm.area = calculate_area_hectares(boundary_geojson)

        # Auto-derive centroid coordinates if absent
        centroid = shapely_geom.centroid
        db_farm.latitude = float(centroid.y)
        db_farm.longitude = float(centroid.x)

        db.commit()
        db.refresh(db_farm)

        # Auto-trigger satellite + risk analysis now that boundary exists
        if db_farm.latitude and db_farm.longitude:
            try:
                process_single_farm.delay(db_farm.id, 30)
            except Exception:
                pass
            try:
                analyze_single_farm_risk.delay(db_farm.id)
            except Exception:
                pass

        return {
            "success": True,
            "farm_id": farm_id,
            "area_ha": db_farm.area,
            "boundary_geojson": boundary_geojson,
            "message": f"Boundary saved successfully ({db_farm.area:.2f} hectares)"
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Failed to save boundary: {str(e)}"
        )


@router.post("/{farm_id}/auto-fetch-satellite")
def auto_fetch_satellite(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Trigger on-demand satellite data fetch and risk analysis for a single farm.

    Enqueues Celery tasks for satellite imagery download, vegetation index
    computation, and composite crop-risk analysis.

    Returns 202 with task_id for progress polling via /stress-monitoring/task-status/{task_id}.
    """
    # Get farm
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Check permissions
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    # Must have coordinates
    if not db_farm.latitude or not db_farm.longitude:
        raise HTTPException(
            status_code=400,
            detail="Farm must have coordinates (latitude/longitude) for satellite fetch"
        )

    # Enqueue satellite processing task
    try:
        task = process_single_farm.delay(db_farm.id, 30)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Task queue unavailable: {str(e)}"
        )

    # Also trigger crop risk analysis (fire-and-forget)
    try:
        analyze_single_farm_risk.delay(db_farm.id)
    except Exception:
        pass  # Non-critical; satellite fetch is the primary task

    from starlette.responses import JSONResponse
    return JSONResponse(
        status_code=202,
        content={
            "farm_id": farm_id,
            "task_id": task.id,
            "message": "Satellite fetch queued",
        },
    )


@router.get("/detect-location")
def detect_location(
    latitude: float, 
    longitude: float,
    current_user: UserModel = Depends(require_farmer_or_above)
):
    """
    Detect location details (Province, District) from coordinates.
    Uses OpenStreetMap Nominatim API with a fallback to local heuristic.
    """
    
    # Validate coordinates are in Rwanda first
    is_valid, error_msg = validate_point_in_rwanda(latitude, longitude)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail=f"Location must be within Rwanda. {error_msg}"
        )
        
    result = detect_location_details(latitude, longitude)
    
    if not result['province']:
        return {
            "success": False,
            "message": "Could not detect location details."
        }
        
    return {
        "success": True,
        "province": result['province'],
        "district": result['district'],
        "sector": result['sector'],
        "source": result['source'],
        "message": f"Detected: {result['district']}, {result['province']}"
    }
