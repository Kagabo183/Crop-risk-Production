"""
Farmer Advisory API Endpoints.

Provides daily personalized tips per farm and a one-call summary
across all farms owned by the current user.

Designed for low-bandwidth mobile use:
  - Compact JSON response (no heavy data)
  - Single endpoint to populate the mobile dashboard advisory card
  - Optional risk score inclusion (adds latency, can be toggled off)
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import check_farm_access, require_farmer_or_above
from app.db.database import get_db
from app.models.farm import Farm
from app.models.user import User as UserModel

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/daily/{farm_id}")
async def get_daily_advisory(
    farm_id: int,
    include_risk: bool = Query(
        default=True,
        description="Include ensemble risk score in advisory generation. "
                    "Set to false for faster response on slow connections.",
    ),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Get 3-5 personalised daily advisory tips for a single farm.

    Tips are based on:
    - Ensemble risk score (disease + weather + vegetation anomaly)
    - Last 5 disease scan results linked to this farm
    - Recent weather records stored for the farm
    - Crop type and days-after-planting growth stage

    Response is intentionally compact (<2 KB) to minimise mobile data usage.
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    check_farm_access(farm, current_user)

    try:
        from app.services.advisory_engine import FarmerAdvisoryEngine
        engine = FarmerAdvisoryEngine()

        # ── Collect inputs (all failures are soft — advisory degrades gracefully) ──

        risk_result = _get_risk_result(farm_id, db) if include_risk else None
        weather = _get_weather(farm_id, db)
        recent_scans = _get_recent_scans(farm_id, current_user.id, db)

        # ── Generate ──────────────────────────────────────────────────────────
        advisories = engine.generate(
            farm=farm,
            risk_result=risk_result,
            weather=weather,
            recent_scans=recent_scans,
            db=db,
        )

        return {
            "farm_id": farm_id,
            "farm_name": farm.name,
            "crop_type": farm.crop_type,
            "generated_at": datetime.utcnow().isoformat(),
            "advisories": engine.to_api_response(advisories),
            "total": len(advisories),
            "risk_included": risk_result is not None,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Advisory generation failed for farm {farm_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_advisory_summary(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    Get the top advisory tip for every farm owned by the current user.

    Useful for the mobile dashboard — one API call populates the
    advisory cards for all farms without separate per-farm requests.

    Response stays compact because only the #1 priority tip is included
    per farm, not the full list.
    """
    try:
        from app.services.advisory_engine import FarmerAdvisoryEngine
        engine = FarmerAdvisoryEngine()

        farms = db.query(Farm).filter(Farm.owner_id == current_user.id).all()
        if not farms:
            return {"farms": [], "total_farms": 0, "generated_at": datetime.utcnow().isoformat()}

        summaries = []
        for farm in farms:
            try:
                recent_scans = _get_recent_scans(farm.id, current_user.id, db)
                weather = _get_weather(farm.id, db)

                advisories = engine.generate(
                    farm=farm,
                    recent_scans=recent_scans,
                    weather=weather,
                    db=db,
                )
                top = advisories[0] if advisories else None
                summaries.append({
                    "farm_id": farm.id,
                    "farm_name": farm.name,
                    "crop_type": farm.crop_type,
                    "top_advisory": engine.to_api_response([top])[0] if top else None,
                    "total_tips": len(advisories),
                })
            except Exception as e:
                logger.warning(f"Advisory failed for farm {farm.id}: {e}")
                summaries.append({
                    "farm_id": farm.id,
                    "farm_name": farm.name,
                    "crop_type": farm.crop_type,
                    "top_advisory": None,
                    "total_tips": 0,
                })

        return {
            "farms": summaries,
            "total_farms": len(farms),
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"Advisory summary failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Private helpers ────────────────────────────────────────────────────────────

def _get_risk_result(farm_id: int, db: Session) -> Optional[dict]:
    """Fetch ensemble risk score; returns None on any failure."""
    try:
        from app.ml.ensemble_scorer import EnsembleRiskScorer
        from app.api.v1.endpoints.ml import get_farm_data
        farm_data = get_farm_data(farm_id, db)
        return EnsembleRiskScorer().calculate_risk(farm_data)
    except Exception as e:
        logger.debug(f"Risk score skipped for advisory (farm {farm_id}): {e}")
        return None


def _get_weather(farm_id: int, db: Session) -> Optional[dict]:
    """Build a compact weather summary from stored WeatherRecord rows."""
    try:
        from app.models.data import WeatherRecord
        rows = (
            db.query(WeatherRecord)
            .filter(WeatherRecord.farm_id == farm_id)
            .order_by(WeatherRecord.date.desc())
            .limit(7)
            .all()
        )
        if not rows:
            return None

        temps = [r.temperature for r in rows if r.temperature is not None]
        rainfall = [r.rainfall for r in rows if r.rainfall is not None]
        humidity_vals = [
            r.humidity for r in rows
            if hasattr(r, "humidity") and r.humidity is not None
        ]
        return {
            "temp_max": max(temps) if temps else 25.0,
            "rainfall_7d": sum(rainfall) if rainfall else 0.0,
            "humidity": sum(humidity_vals) / len(humidity_vals) if humidity_vals else 65.0,
            "forecast_rain_days": 0,
        }
    except Exception as e:
        logger.debug(f"Weather data skipped for advisory (farm {farm_id}): {e}")
        return None


def _get_recent_scans(farm_id: int, user_id: int, db: Session) -> list:
    """Fetch last 5 disease scans linked to this farm and user."""
    try:
        from app.models.data import DiseaseClassification
        scans = (
            db.query(DiseaseClassification)
            .filter(
                DiseaseClassification.farm_id == farm_id,
                DiseaseClassification.user_id == user_id,
            )
            .order_by(DiseaseClassification.created_at.desc())
            .limit(5)
            .all()
        )
        return [
            {
                "disease": s.disease,
                "plant": s.plant,
                "is_healthy": s.is_healthy,
                "confidence": s.confidence,
            }
            for s in scans
        ]
    except Exception as e:
        logger.debug(f"Scan history skipped for advisory (farm {farm_id}): {e}")
        return []
