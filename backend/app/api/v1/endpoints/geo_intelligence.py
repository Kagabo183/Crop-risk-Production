"""
Geo-intelligence API endpoints
-------------------------------
Prefix: /geo

Routes:
  GET  /geo/farms/{farm_id}/timeline          – NDVI/NDRE/EVI/NDWI/SAVI time-series
  GET  /geo/farms/{farm_id}/ndvi-tiles        – GEE tile URL or fallback overlay info
  GET  /geo/farms/{farm_id}/zones             – Stored productivity zones (GeoJSON)
  POST /geo/farms/{farm_id}/zones/compute     – (Re)compute K-means productivity zones
  GET  /geo/farms/{farm_id}/hotspots          – NDVI anomaly stress hotspots
  GET  /geo/farms/{farm_id}/scouting          – List field scouting observations
  POST /geo/farms/{farm_id}/scouting          – Create scouting observation
  DELETE /geo/scouting/{obs_id}               – Delete observation
  POST /geo/scouting/{obs_id}/photo           – Attach photo to observation
  GET  /geo/farms/{farm_id}/crop-classification – Spectral crop type inference
"""
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

import numpy as np

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.core.auth import get_current_active_user, require_farmer_or_above
from app.db.database import get_db
from app.models.data import SatelliteImage, VegetationHealth
from app.models.farm import Farm as FarmModel
from app.models.geo_intelligence import ProductivityZone, ScoutingObservation
from app.models.user import User as UserModel

logger = logging.getLogger(__name__)
router = APIRouter()

SCOUTING_UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/data/uploads")) / "scouting"
SCOUTING_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── Shared helpers ────────────────────────────────────────────────────────────

def _get_farm(farm_id: int, db: Session, user: UserModel) -> FarmModel:
    farm = db.query(FarmModel).filter(FarmModel.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    if user.role == "farmer" and farm.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not your farm")
    return farm


def _zone_to_dict(z: ProductivityZone) -> dict:
    boundary_geojson = None
    if z.boundary is not None:
        try:
            from geoalchemy2.shape import to_shape
            s = to_shape(z.boundary)
            boundary_geojson = json.loads(json.dumps(s.__geo_interface__))
        except Exception:
            pass
    return {
        "id": z.id,
        "zone_class": z.zone_class,
        "mean_ndvi": z.mean_ndvi,
        "color_hex": z.color_hex,
        "zone_index": z.zone_index,
        "area_ha": z.area_ha,
        "computed_at": z.computed_at.isoformat() if z.computed_at else None,
        "boundary": boundary_geojson,
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class ScoutingCreate(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    observation_type: str = Field(
        ..., description="One of: disease | pest | stress | general"
    )
    severity: Optional[str] = Field(None, description="low | moderate | high | critical")
    notes: Optional[str] = Field(None, max_length=2000)
    tags: Optional[List[str]] = None


# ── 1. Vegetation timeline ────────────────────────────────────────────────────

@router.get("/farms/{farm_id}/timeline")
def get_vegetation_timeline(
    farm_id: int,
    days_back: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Return daily vegetation index time-series for the last N days.

    Primary source: VegetationHealth records.
    Supplement: SatelliteImage records for any dates below 10 vh records.
    """
    _get_farm(farm_id, db, current_user)
    since = date.today() - timedelta(days=days_back)

    vh_records = (
        db.query(VegetationHealth)
        .filter(VegetationHealth.farm_id == farm_id, VegetationHealth.date >= since)
        .order_by(VegetationHealth.date.asc())
        .all()
    )

    series = [
        {
            "date": r.date.isoformat(),
            "ndvi": r.ndvi,
            "ndre": r.ndre,
            "ndwi": r.ndwi,
            "evi": r.evi,
            "savi": r.savi,
            "health_score": r.health_score,
            "stress_level": r.stress_level,
        }
        for r in vh_records
    ]

    # Supplement with satellite images when VH records are sparse
    if len(series) < 10:
        existing_dates = {s["date"] for s in series}
        sat_records = (
            db.query(SatelliteImage)
            .filter(
                SatelliteImage.farm_id == farm_id,
                SatelliteImage.date >= since,
                SatelliteImage.mean_ndvi.isnot(None),
            )
            .order_by(SatelliteImage.date.asc())
            .all()
        )
        for r in sat_records:
            d = r.date.isoformat() if hasattr(r.date, "isoformat") else str(r.date)
            if d not in existing_dates:
                series.append({
                    "date": d,
                    "ndvi": r.mean_ndvi,
                    "ndre": r.mean_ndre,
                    "ndwi": r.mean_ndwi,
                    "evi": r.mean_evi,
                    "savi": r.mean_savi,
                    "health_score": None,
                    "stress_level": None,
                })
        series.sort(key=lambda x: x["date"])

    return {"farm_id": farm_id, "days_back": days_back, "data_points": len(series), "series": series}


# ── 2. NDVI tile overlay ──────────────────────────────────────────────────────

@router.get("/farms/{farm_id}/ndvi-tiles")
def get_ndvi_tiles(
    farm_id: int,
    days_back: int = Query(30, ge=7, le=180),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get NDVI tile info for Leaflet map overlay.

    When GEE is available, returns a signed tile URL template usable in
    `L.tileLayer(url)` or react-leaflet `<TileLayer url={...} />`.

    When GEE is unavailable, returns `tile_url: null` plus `color_hex` and
    `bounds` so the frontend can render a coloured polygon overlay instead.
    """
    farm = _get_farm(farm_id, db, current_user)
    if not (farm.latitude and farm.longitude):
        raise HTTPException(status_code=400, detail="Farm has no coordinates")

    from app.services.ndvi_tile_service import NdviTileService
    info = NdviTileService().get_ndvi_tile_info(farm, db, days_back=days_back)
    return {"farm_id": farm_id, **info}


# ── 3. Productivity zones – read ──────────────────────────────────────────────

@router.get("/farms/{farm_id}/zones")
def get_productivity_zones(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """Return stored productivity zones for a farm as GeoJSON-ready dicts."""
    _get_farm(farm_id, db, current_user)
    zones = (
        db.query(ProductivityZone)
        .filter(ProductivityZone.farm_id == farm_id)
        .order_by(ProductivityZone.zone_index)
        .all()
    )
    return {"farm_id": farm_id, "count": len(zones), "zones": [_zone_to_dict(z) for z in zones]}


# ── 4. Productivity zones – compute ─────────────────────────────────────────

@router.post("/farms/{farm_id}/zones/compute")
def compute_productivity_zones(
    farm_id: int,
    n_zones: int = Query(3, ge=2, le=5, description="Number of productivity classes"),
    days_back: int = Query(90, ge=30, le=365),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """
    (Re)compute K-means productivity zones for a farm.

    Uses Google Earth Engine when available; falls back to statistical
    simulation from historical VegetationHealth records.
    """
    farm = _get_farm(farm_id, db, current_user)
    if not (farm.latitude and farm.longitude):
        raise HTTPException(status_code=400, detail="Farm has no coordinates")

    from app.services.productivity_zone_service import ProductivityZoneService
    zones = ProductivityZoneService().compute_and_save(
        farm=farm, db=db, n_zones=n_zones, days_back=days_back
    )
    return {
        "farm_id": farm_id,
        "zones_computed": len(zones),
        "zones": [
            {k: v for k, v in z.items() if k != "boundary"}
            for z in zones
        ],
        "message": f"Computed {len(zones)} productivity zones",
    }


# ── 5. Stress hotspots ────────────────────────────────────────────────────────

@router.get("/farms/{farm_id}/hotspots")
def get_stress_hotspots(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Detect NDVI anomaly stress hotspots.

    Compares recent 14-day NDVI mean against a 90-day baseline.
    Returns the farm boundary tagged with severity when a significant
    decline is detected.
    """
    farm = _get_farm(farm_id, db, current_user)
    since_90 = date.today() - timedelta(days=90)
    since_14 = date.today() - timedelta(days=14)

    def _ndvi_vals(q_from, q_to):
        recs = (
            db.query(VegetationHealth)
            .filter(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= q_from,
                VegetationHealth.date < q_to,
            )
            .all()
        )
        return [r.ndvi for r in recs if r.ndvi is not None]

    baseline_vals = _ndvi_vals(since_90, since_14)
    recent_vals = _ndvi_vals(since_14, date.today() + timedelta(days=1))

    if not baseline_vals or not recent_vals:
        return {"farm_id": farm_id, "hotspots": [], "message": "Insufficient history"}

    baseline_mean = float(np.mean(baseline_vals))
    recent_mean = float(np.mean(recent_vals))
    anomaly = recent_mean - baseline_mean

    severity_map = [
        (-0.15, "high",     "#F44336"),
        (-0.08, "moderate", "#FF9800"),
        (-0.03, "low",      "#FFC107"),
    ]
    severity = color = None
    for threshold, sev, col in severity_map:
        if anomaly < threshold:
            severity, color = sev, col
            break

    if severity is None:
        return {
            "farm_id": farm_id,
            "hotspots": [],
            "ndvi_anomaly": round(anomaly, 4),
            "message": "No significant stress hotspots detected",
        }

    boundary_geojson = None
    if farm.boundary is not None:
        try:
            from geoalchemy2.shape import to_shape
            s = to_shape(farm.boundary)
            boundary_geojson = json.loads(json.dumps(s.__geo_interface__))
        except Exception:
            pass

    hotspot = {
        "id": f"farm_{farm_id}_hotspot",
        "severity": severity,
        "color_hex": color,
        "ndvi_anomaly": round(anomaly, 4),
        "baseline_ndvi": round(baseline_mean, 4),
        "recent_ndvi": round(recent_mean, 4),
        "boundary": boundary_geojson,
        "detected_at": date.today().isoformat(),
    }
    return {"farm_id": farm_id, "hotspots": [hotspot], "ndvi_anomaly": round(anomaly, 4)}


# ── 6. Field scouting – list ──────────────────────────────────────────────────

@router.get("/farms/{farm_id}/scouting")
def list_scouting_observations(
    farm_id: int,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """List field scouting observations for a farm, newest first."""
    _get_farm(farm_id, db, current_user)
    obs = (
        db.query(ScoutingObservation)
        .filter(ScoutingObservation.farm_id == farm_id)
        .order_by(ScoutingObservation.observed_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "farm_id": farm_id,
        "count": len(obs),
        "observations": [
            {
                "id": o.id,
                "latitude": o.latitude,
                "longitude": o.longitude,
                "observation_type": o.observation_type,
                "severity": o.severity,
                "notes": o.notes,
                "tags": o.tags or [],
                "photo_paths": o.photo_paths or [],
                "observed_at": o.observed_at.isoformat() if o.observed_at else None,
                "observer_id": o.user_id,
            }
            for o in obs
        ],
    }


# ── 7. Field scouting – create ────────────────────────────────────────────────

@router.post("/farms/{farm_id}/scouting", status_code=201)
def create_scouting_observation(
    farm_id: int,
    payload: ScoutingCreate,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Record a new geolocated field scouting observation."""
    _get_farm(farm_id, db, current_user)

    point_wkb = None
    try:
        from geoalchemy2.shape import from_shape
        from shapely.geometry import Point
        point_wkb = from_shape(Point(payload.longitude, payload.latitude), srid=4326)
    except Exception:
        pass

    obs = ScoutingObservation(
        farm_id=farm_id,
        user_id=current_user.id,
        observed_at=datetime.utcnow(),
        latitude=payload.latitude,
        longitude=payload.longitude,
        point=point_wkb,
        observation_type=payload.observation_type,
        severity=payload.severity,
        notes=payload.notes,
        tags=payload.tags or [],
        photo_paths=[],
    )
    db.add(obs)
    db.commit()
    db.refresh(obs)

    return {
        "id": obs.id,
        "farm_id": farm_id,
        "latitude": obs.latitude,
        "longitude": obs.longitude,
        "observation_type": obs.observation_type,
        "severity": obs.severity,
        "observed_at": obs.observed_at.isoformat(),
        "message": "Observation recorded",
    }


# ── 8. Field scouting – delete ────────────────────────────────────────────────

@router.delete("/scouting/{obs_id}")
def delete_scouting_observation(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Delete a scouting observation. Farmers may only delete their own records."""
    obs = db.query(ScoutingObservation).filter(ScoutingObservation.id == obs_id).first()
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if current_user.role == "farmer" and obs.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your observation")
    db.delete(obs)
    db.commit()
    return {"deleted": True, "id": obs_id}


# ── 9. Field scouting – photo upload ─────────────────────────────────────────

@router.post("/scouting/{obs_id}/photo")
async def upload_scouting_photo(
    obs_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(require_farmer_or_above),
):
    """Attach a photo to an existing scouting observation (max 10 MB, images only)."""
    obs = db.query(ScoutingObservation).filter(ScoutingObservation.id == obs_id).first()
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if current_user.role == "farmer" and obs.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your observation")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image files are accepted")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    suffix = Path(file.filename).suffix if file.filename else ".jpg"
    filename = f"scout_{obs_id}_{uuid.uuid4().hex[:8]}{suffix}"
    dest = SCOUTING_UPLOAD_DIR / filename
    dest.write_bytes(content)

    paths = list(obs.photo_paths or [])
    paths.append(f"scouting/{filename}")
    obs.photo_paths = paths
    db.commit()

    return {"obs_id": obs_id, "photo_path": f"scouting/{filename}"}


# ── 10. Spectral crop type classification ────────────────────────────────────

@router.get("/farms/{farm_id}/crop-classification")
def get_crop_classification(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Infer crop type from Sentinel-2 spectral band signatures.

    Uses a rule-based spectral scorer (NDVI, NDWI, SWIR moisture index).
    A declared crop_type on the farm acts as a Bayesian prior.
    Falls back to the declared type when GEE is unavailable.
    """
    farm = _get_farm(farm_id, db, current_user)

    from app.core import gee_manager
    if gee_manager.is_initialized():
        try:
            result = _classify_crop_gee(farm)
            return {"farm_id": farm_id, **result}
        except Exception as exc:
            logger.warning("GEE crop classification failed for farm %s: %s", farm_id, exc)

    declared = farm.crop_type or "unknown"
    return {
        "farm_id": farm_id,
        "predicted_crop": declared,
        "confidence": 0.0,
        "source": "declared",
        "spectral_indices": None,
        "message": "GEE unavailable; returning declared crop type",
    }


def _classify_crop_gee(farm: FarmModel) -> dict:
    """Rule-based spectral classifier using Sentinel-2 band medians."""
    import ee

    if farm.boundary is not None:
        try:
            from geoalchemy2.shape import to_shape
            s = to_shape(farm.boundary)
            coords = list(s.exterior.coords)
            geom = ee.Geometry.Polygon([[[c[0], c[1]] for c in coords]])
        except Exception:
            geom = ee.Geometry.Point([farm.longitude, farm.latitude]).buffer(300)
    else:
        geom = ee.Geometry.Point([farm.longitude, farm.latitude]).buffer(300)

    end = datetime.utcnow()
    start = end - timedelta(days=60)

    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geom)
        .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .select(["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B11", "B12"])
    )

    if collection.size().getInfo() == 0:
        return {
            "predicted_crop": farm.crop_type or "unknown",
            "confidence": 0.0,
            "source": "no_imagery",
        }

    band_means = collection.median().reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=30,
        maxPixels=1_000_000,
    ).getInfo()

    b3  = float(band_means.get("B3") or 0)   # Green
    b4  = float(band_means.get("B4") or 0)   # Red
    b8  = float(band_means.get("B8") or 0)   # NIR
    b11 = float(band_means.get("B11") or 0)  # SWIR1

    eps = 1e-9
    ndvi = (b8 - b4) / (b8 + b4 + eps)
    ndwi = (b3 - b8) / (b3 + b8 + eps)
    ndii = (b8 - b11) / (b8 + b11 + eps)   # Moisture index

    # Spectral scores (simplified literature-based rules)
    crop_scores = {
        "maize":   max(0.0, ndvi * 0.60 + ndii * 0.40),
        "rice":    max(0.0, ndvi * 0.35 + (1 + ndwi) * 0.35 + ndii * 0.30),
        "potato":  max(0.0, ndvi * 0.70 + ndii * 0.30),
        "wheat":   max(0.0, ndvi * 0.50 + (1 - ndii) * 0.30 + 0.20),
        "beans":   max(0.0, ndvi * 0.60 + ndii * 0.40),
        "cassava": max(0.0, ndvi * 0.50 + ndii * 0.50),
    }

    # Prior boost for declared crop_type
    declared = (farm.crop_type or "").lower().split(",")[0].strip()
    if declared in crop_scores:
        crop_scores[declared] = crop_scores[declared] + 0.20

    predicted = max(crop_scores, key=crop_scores.get)
    total = sum(crop_scores.values()) + eps
    confidence = crop_scores[predicted] / total

    return {
        "predicted_crop": predicted,
        "confidence": round(confidence, 3),
        "source": "gee_spectral",
        "spectral_indices": {
            "ndvi": round(ndvi, 4),
            "ndwi": round(ndwi, 4),
            "ndii": round(ndii, 4),
        },
        "all_scores": {k: round(v, 3) for k, v in crop_scores.items()},
    }
