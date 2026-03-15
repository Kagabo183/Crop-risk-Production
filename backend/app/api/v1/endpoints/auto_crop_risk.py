"""
Auto Crop Risk API Endpoint
POST /api/v1/farm/analyze-risk — full auto satellite → risk pipeline for a farm
GET  /api/v1/farm/analyze-risk/{farm_id} — shortcut GET for a single farm
POST /api/v1/farm/analyze-risk/all — run for all farms (admin only)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional
from datetime import datetime

from app.db.database import get_db
from app.models.farm import Farm
from app.models.user import User as UserModel
from app.core.auth import get_current_active_user

router = APIRouter()


# ── Request / Response schemas ──

class AnalyzeRiskRequest(BaseModel):
    farm_id: int = Field(..., description="ID of the farm to analyse")
    days_back: int = Field(15, ge=1, le=90, description="Look-back window for satellite imagery (days)")
    max_cloud_cover: float = Field(20.0, ge=0, le=100, description="Max cloud cover percentage")
    force_refresh: bool = Field(False, description="Bypass 24-hour cache")


class VegetationIndicesOut(BaseModel):
    NDVI: Optional[float] = None
    NDRE: Optional[float] = None
    NDWI: Optional[float] = None
    EVI: Optional[float] = None
    SAVI: Optional[float] = None


class DiseaseRiskOut(BaseModel):
    disease: str
    risk_score: float
    risk_level: str
    recommended_actions: List[str] = []


class AnalyzeRiskResponse(BaseModel):
    farm_id: int
    crop_type: Optional[str] = None
    composite_health_score: float
    health_status: str
    vegetation_indices: VegetationIndicesOut
    detected_risk: List[str] = []
    disease_risk: List[DiseaseRiskOut] = []
    recommended_action: List[str] = []
    data_source: str = "google_earth_engine"
    analysis_timestamp: str


class AllFarmsRiskSummary(BaseModel):
    total: int
    success: int
    failed: int
    results: List[Dict[str, Any]] = []


# ── Helpers ──

def _check_farm_access(farm: Farm, user: UserModel):
    """Enforce role-based farm access."""
    if user.role == "farmer" and farm.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied — not your farm")
    if user.role == "agronomist" and user.district:
        if farm.location and not farm.location.startswith(user.district):
            raise HTTPException(status_code=403, detail="Access denied — farm outside your district")


# ── Endpoints ──

@router.post("/analyze-risk", response_model=AnalyzeRiskResponse)
def analyze_farm_risk(
    request: AnalyzeRiskRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    **Auto Crop Risk Analysis**

    Automatically fetches satellite imagery, calculates vegetation indices,
    computes a composite health score, runs disease risk models, and returns
    a comprehensive risk assessment — all without manual input.

    The result is cached for 24 hours (pass `force_refresh=true` to bypass).
    """
    from app.services.auto_crop_risk_service import AutoCropRiskService

    # Verify farm exists and user has access
    farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    _check_farm_access(farm, current_user)

    try:
        service = AutoCropRiskService()
        result = service.analyze_farm_risk(
            db=db,
            farm_id=request.farm_id,
            days_back=request.days_back,
            max_cloud_cover=request.max_cloud_cover,
            force_refresh=request.force_refresh,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {str(exc)}")


@router.get("/analyze-risk/{farm_id}", response_model=AnalyzeRiskResponse)
def get_farm_risk(
    farm_id: int,
    force_refresh: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Quick GET endpoint to retrieve (or trigger) crop risk analysis for a farm.
    Returns cached result if available, or runs a fresh analysis.
    """
    from app.services.auto_crop_risk_service import AutoCropRiskService

    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    _check_farm_access(farm, current_user)

    try:
        service = AutoCropRiskService()
        result = service.analyze_farm_risk(
            db=db,
            farm_id=farm_id,
            force_refresh=force_refresh,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {str(exc)}")


@router.post("/analyze-risk/all", response_model=AllFarmsRiskSummary)
def analyze_all_farms_risk(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Run auto crop risk analysis on **all** farms with coordinates.
    Admin/agronomist only.
    """
    if current_user.role not in ("admin", "agronomist"):
        raise HTTPException(status_code=403, detail="Admin or agronomist role required")

    from app.services.auto_crop_risk_service import AutoCropRiskService

    try:
        service = AutoCropRiskService()
        summary = service.analyze_all_farms(db)
        return summary
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch analysis failed: {str(exc)}")
