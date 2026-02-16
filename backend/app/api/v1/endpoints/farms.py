from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from pydantic import BaseModel, ConfigDict, Field

from app.db.database import get_db
from app.models.farm import Farm as FarmModel
from app.models.user import User as UserModel
from app.core.auth import get_current_active_user, require_farmer_or_above
from app.tasks.satellite_tasks import process_single_farm

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
    growth_stage: Optional[dict] = None
    owner_id: Optional[int] = None


class FarmCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    province: Optional[str] = Field(None, max_length=50)
    crop_type: Optional[str] = Field(None, max_length=255, description="Comma-separated crop types, e.g. 'potato, maize'")
    area: Optional[float] = Field(None, ge=0, description="Area in hectares")
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    planting_date: Optional[date] = None


class FarmUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    province: Optional[str] = Field(None, max_length=50)
    crop_type: Optional[str] = Field(None, max_length=255)
    area: Optional[float] = Field(None, ge=0)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    planting_date: Optional[date] = None


def _farm_to_out(farm: FarmModel) -> dict:
    """Convert ORM Farm to dict with computed growth_stage."""
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
        "growth_stage": compute_growth_stage(farm.crop_type, farm.planting_date),
        "owner_id": farm.owner_id,
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
    """Register a new farm. Auto-assigns owner_id to the current user."""
    db_farm = FarmModel(
        name=farm.name,
        location=farm.location,
        province=farm.province,
        crop_type=farm.crop_type,
        area=farm.area,
        latitude=farm.latitude,
        longitude=farm.longitude,
        planting_date=farm.planting_date,
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

    return _farm_to_out(db_farm)


@router.put("/{farm_id}", response_model=FarmOut)
def update_farm(
    farm_id: int, farm: FarmUpdate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Update an existing farm. Farmers can only update their own farms."""
    db_farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not db_farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if current_user.role == "farmer" and db_farm.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your farm")

    update_data = farm.model_dump(exclude_unset=True)
    coords_changed = 'latitude' in update_data or 'longitude' in update_data
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
