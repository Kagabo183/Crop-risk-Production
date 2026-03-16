"""
Precision Agriculture API
==========================
Combined router for Season management, VRA prescription maps,
Soil sampling, and Yield analysis.

Prefix : /precision-ag   (registered in api.py)
Tag    : precision-agriculture
"""
import json
import os
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.precision_ag import (
    Season, CropRotation, SoilSample, SoilNutrientResult, YieldMap, VraMap,
)
from app.services import (
    season_service, vra_service, soil_sampling_service, yield_analysis_service,
)

router = APIRouter()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/data/uploads")


# ────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ────────────────────────────────────────────────────────────────────────────

class SeasonCreate(BaseModel):
    name: str
    year: int
    crop_type: str
    planting_date: Optional[date] = None
    harvest_date: Optional[date] = None
    target_yield_tha: Optional[float] = None
    area_planted_ha: Optional[float] = None
    status: Optional[str] = "planning"
    notes: Optional[str] = None


class SeasonUpdate(BaseModel):
    name: Optional[str] = None
    crop_type: Optional[str] = None
    planting_date: Optional[date] = None
    harvest_date: Optional[date] = None
    target_yield_tha: Optional[float] = None
    area_planted_ha: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class VraGenerateRequest(BaseModel):
    prescription_type: str           # seeding | fertilizer | chemical
    base_rate: float                 # kg/ha or L/ha
    product_name: Optional[str] = "Product"
    season_id: Optional[int] = None


class GridSamplingRequest(BaseModel):
    grid_size_m: int = 100
    notes: Optional[str] = None


class ZoneSamplingRequest(BaseModel):
    notes: Optional[str] = None


class NutrientResultItem(BaseModel):
    zone_label: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    nitrogen: Optional[float] = None
    phosphorus: Optional[float] = None
    potassium: Optional[float] = None
    organic_matter: Optional[float] = None
    ph: Optional[float] = None
    moisture: Optional[float] = None
    raw_data: Optional[dict] = None


class NutrientResultsBatch(BaseModel):
    results: List[NutrientResultItem]


# ────────────────────────────────────────────────────────────────────────────
# Helper
# ────────────────────────────────────────────────────────────────────────────

def _season_dict(s: Season) -> dict:
    return {
        "id":              s.id,
        "farm_id":         s.farm_id,
        "name":            s.name,
        "year":            s.year,
        "crop_type":       s.crop_type,
        "planting_date":   s.planting_date.isoformat() if s.planting_date else None,
        "harvest_date":    s.harvest_date.isoformat() if s.harvest_date else None,
        "target_yield_tha": s.target_yield_tha,
        "area_planted_ha": s.area_planted_ha,
        "status":          s.status,
        "notes":           s.notes,
        "created_at":      s.created_at.isoformat() if s.created_at else None,
    }


def _rotation_dict(r: CropRotation) -> dict:
    return {
        "id":                       r.id,
        "farm_id":                  r.farm_id,
        "season_id":                r.season_id,
        "previous_crop":            r.previous_crop,
        "current_crop":             r.current_crop,
        "next_crop_recommendation": r.next_crop_recommendation,
        "rotation_score":           r.rotation_score,
        "nitrogen_fixation":        r.nitrogen_fixation,
        "rest_period_weeks":        r.rest_period_weeks,
        "notes":                    r.notes,
        "recommendations":          r.recommendations,
        "created_at":               r.created_at.isoformat() if r.created_at else None,
    }


def _vra_dict(v: VraMap) -> dict:
    return {
        "id":               v.id,
        "farm_id":          v.farm_id,
        "season_id":        v.season_id,
        "prescription_type": v.prescription_type,
        "product_name":     v.product_name,
        "base_rate":        v.base_rate,
        "high_zone_rate":   v.high_zone_rate,
        "medium_zone_rate": v.medium_zone_rate,
        "low_zone_rate":    v.low_zone_rate,
        "total_product_kg": v.total_product_kg,
        "savings_pct":      v.savings_pct,
        "zones_geojson":    v.zones_geojson,
        "rates_json":       v.rates_json,
        "generated_at":     v.generated_at.isoformat() if v.generated_at else None,
    }


def _soil_dict(s: SoilSample) -> dict:
    return {
        "id":               s.id,
        "farm_id":          s.farm_id,
        "sampling_method":  s.sampling_method,
        "grid_size_m":      s.grid_size_m,
        "sampled_at":       s.sampled_at.isoformat() if s.sampled_at else None,
        "total_zones":      s.total_zones,
        "notes":            s.notes,
        "sampling_geojson": s.sampling_geojson,
        "created_at":       s.created_at.isoformat() if s.created_at else None,
    }


def _yield_dict(y: YieldMap) -> dict:
    return {
        "id":                 y.id,
        "farm_id":            y.farm_id,
        "season_id":          y.season_id,
        "crop_type":          y.crop_type,
        "harvest_date":       y.harvest_date.isoformat() if y.harvest_date else None,
        "mean_yield_tha":     y.mean_yield_tha,
        "max_yield_tha":      y.max_yield_tha,
        "min_yield_tha":      y.min_yield_tha,
        "total_yield_kg":     y.total_yield_kg,
        "area_harvested_ha":  y.area_harvested_ha,
        "variability_cv":     y.variability_cv,
        "high_yield_area_ha": y.high_yield_area_ha,
        "low_yield_area_ha":  y.low_yield_area_ha,
        "zone_comparison":    y.zone_comparison,
        "created_at":         y.created_at.isoformat() if y.created_at else None,
    }


# ════════════════════════════════════════════════════════════════════════════
# SEASON endpoints
# ════════════════════════════════════════════════════════════════════════════

@router.get("/farms/{farm_id}/seasons")
def list_seasons(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all seasons for a farm (most recent first)."""
    seasons = season_service.list_seasons(farm_id, db)
    return {"farm_id": farm_id, "seasons": [_season_dict(s) for s in seasons]}


@router.post("/farms/{farm_id}/seasons", status_code=201)
def create_season(
    farm_id: int,
    payload: SeasonCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new season record for a farm."""
    data = payload.dict(exclude_unset=True)
    season = season_service.create_season(farm_id, data, db)
    return _season_dict(season)


@router.get("/seasons/{season_id}")
def get_season(
    season_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    season = season_service.get_season(season_id, db)
    if not season:
        raise HTTPException(404, f"Season {season_id} not found")
    return _season_dict(season)


@router.put("/seasons/{season_id}")
def update_season(
    season_id: int,
    payload: SeasonUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    season = season_service.update_season(season_id, payload.dict(exclude_unset=True), db)
    if not season:
        raise HTTPException(404, f"Season {season_id} not found")
    return _season_dict(season)


@router.delete("/seasons/{season_id}", status_code=204)
def delete_season(
    season_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = season_service.delete_season(season_id, db)
    if not ok:
        raise HTTPException(404, f"Season {season_id} not found")


@router.get("/farms/{farm_id}/crop-rotation")
def crop_rotation_history(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full crop rotation history for a farm (timeline format)."""
    history = season_service.get_farm_rotation_history(farm_id, db)
    return {"farm_id": farm_id, "history": history}


@router.post("/seasons/{season_id}/crop-rotation")
def generate_rotation(
    season_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate / refresh crop rotation analysis for the given season."""
    season = db.query(Season).filter(Season.id == season_id).first()
    if not season:
        raise HTTPException(status_code=404, detail=f"Season {season_id} not found")
    try:
        rotation = season_service.generate_crop_rotation(season.farm_id, season_id, db)
        return _rotation_dict(rotation)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ════════════════════════════════════════════════════════════════════════════
# VRA endpoints
# ════════════════════════════════════════════════════════════════════════════

@router.get("/farms/{farm_id}/vra")
def list_vra_maps(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all VRA prescription maps for a farm."""
    maps = (
        db.query(VraMap)
        .filter(VraMap.farm_id == farm_id)
        .order_by(VraMap.generated_at.desc())
        .all()
    )
    return {"farm_id": farm_id, "vra_maps": [_vra_dict(v) for v in maps]}


@router.post("/farms/{farm_id}/vra/generate", status_code=201)
def generate_vra(
    farm_id: int,
    payload: VraGenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a VRA prescription map from stored productivity zones."""
    try:
        vra = vra_service.generate_vra_map(
            farm_id=farm_id,
            prescription_type=payload.prescription_type,
            base_rate=payload.base_rate,
            product_name=payload.product_name or "Product",
            season_id=payload.season_id,
            db=db,
        )
        return _vra_dict(vra)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/vra/{vra_id}")
def get_vra_map(
    vra_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vra = db.query(VraMap).filter(VraMap.id == vra_id).first()
    if not vra:
        raise HTTPException(404, f"VRA map {vra_id} not found")
    return _vra_dict(vra)


@router.get("/vra/{vra_id}/export/geojson")
def export_vra_geojson(
    vra_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the VRA prescription map as a GeoJSON file."""
    vra = db.query(VraMap).filter(VraMap.id == vra_id).first()
    if not vra:
        raise HTTPException(404, f"VRA map {vra_id} not found")
    geojson = vra.zones_geojson or {"type": "FeatureCollection", "features": []}
    content = json.dumps(geojson, indent=2)
    return JSONResponse(
        content=geojson,
        headers={
            "Content-Disposition": f'attachment; filename="vra_{vra_id}_{vra.prescription_type.value}.geojson"',
        },
    )


@router.get("/vra/{vra_id}/export/isoxml", response_class=PlainTextResponse)
def export_vra_isoxml(
    vra_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download VRA prescription map as ISOXML (ISO 11783-10 simplified)."""
    vra = db.query(VraMap).filter(VraMap.id == vra_id).first()
    if not vra:
        raise HTTPException(404, f"VRA map {vra_id} not found")
    xml = vra_service.export_isoxml(vra)
    return PlainTextResponse(
        content=xml,
        headers={
            "Content-Type": "application/xml",
            "Content-Disposition": f'attachment; filename="vra_{vra_id}.xml"',
        },
    )


# ════════════════════════════════════════════════════════════════════════════
# SOIL SAMPLING endpoints
# ════════════════════════════════════════════════════════════════════════════

@router.get("/farms/{farm_id}/soil-samples")
def list_soil_samples(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    samples = (
        db.query(SoilSample)
        .filter(SoilSample.farm_id == farm_id)
        .order_by(SoilSample.created_at.desc())
        .all()
    )
    return {"farm_id": farm_id, "soil_samples": [_soil_dict(s) for s in samples]}


@router.post("/farms/{farm_id}/soil-samples/grid", status_code=201)
def generate_grid_sampling(
    farm_id: int,
    payload: GridSamplingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a regular grid of soil sample points for the farm."""
    try:
        sample = soil_sampling_service.generate_grid_sampling(
            farm_id, payload.grid_size_m, db, payload.notes
        )
        return _soil_dict(sample)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/farms/{farm_id}/soil-samples/zone", status_code=201)
def generate_zone_sampling(
    farm_id: int,
    payload: ZoneSamplingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate zone-based soil sample points (one per productivity zone centroid)."""
    try:
        sample = soil_sampling_service.generate_zone_sampling(
            farm_id, db, payload.notes
        )
        return _soil_dict(sample)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/soil-samples/{sample_id}")
def get_soil_sample(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sample = db.query(SoilSample).filter(SoilSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, f"Soil sample {sample_id} not found")
    summary = soil_sampling_service.get_nutrient_summary(sample_id, db)
    d = _soil_dict(sample)
    d["nutrient_summary"] = summary
    return d


@router.post("/soil-samples/{sample_id}/results", status_code=201)
def upload_nutrient_results(
    sample_id: int,
    payload: NutrientResultsBatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk-upload laboratory nutrient analysis results for a soil sample."""
    sample = db.query(SoilSample).filter(SoilSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, f"Soil sample {sample_id} not found")

    data = [r.dict() for r in payload.results]
    saved = soil_sampling_service.save_nutrient_results(sample_id, data, db)
    summary = soil_sampling_service.get_nutrient_summary(sample_id, db)
    return {"saved": len(saved), "nutrient_summary": summary}


@router.get("/soil-samples/{sample_id}/nutrient-map")
def nutrient_map(
    sample_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return nutrient results as a GeoJSON FeatureCollection for map display."""
    sample = db.query(SoilSample).filter(SoilSample.id == sample_id).first()
    if not sample:
        raise HTTPException(404, f"Soil sample {sample_id} not found")

    results = (
        db.query(SoilNutrientResult)
        .filter(SoilNutrientResult.soil_sample_id == sample_id)
        .all()
    )

    features = []
    for r in results:
        if r.latitude is None or r.longitude is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
            "properties": {
                "zone_label":     r.zone_label,
                "nitrogen":       r.nitrogen,
                "phosphorus":     r.phosphorus,
                "potassium":      r.potassium,
                "organic_matter": r.organic_matter,
                "ph":             r.ph,
                "moisture":       r.moisture,
            },
        })

    return {"type": "FeatureCollection", "features": features}


# ════════════════════════════════════════════════════════════════════════════
# YIELD ANALYSIS endpoints
# ════════════════════════════════════════════════════════════════════════════

@router.get("/farms/{farm_id}/yield-maps")
def list_yield_maps(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    maps = (
        db.query(YieldMap)
        .filter(YieldMap.farm_id == farm_id)
        .order_by(YieldMap.created_at.desc())
        .all()
    )
    return {"farm_id": farm_id, "yield_maps": [_yield_dict(y) for y in maps]}


@router.post("/farms/{farm_id}/yield-maps", status_code=201)
async def upload_yield_map(
    farm_id: int,
    season_id: Optional[int] = Query(None),
    crop_type: Optional[str] = Query(None),
    harvest_date: Optional[date] = Query(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload a yield map GeoJSON file from a harvest monitor.
    Accepted formats: .geojson, .json
    Maximum file size: 20 MB
    """
    MAX_SIZE = 20 * 1024 * 1024
    if file.content_type not in ("application/json", "application/geo+json", "application/octet-stream"):
        if not (file.filename or "").lower().endswith((".geojson", ".json")):
            raise HTTPException(400, "Only GeoJSON files (.geojson, .json) are accepted")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "File too large (max 20 MB)")

    try:
        geojson_data = json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e}")

    # Persist file
    upload_path = os.path.join(UPLOAD_DIR, "yield_maps")
    os.makedirs(upload_path, exist_ok=True)
    safe_name = f"farm{farm_id}_{file.filename or 'yield.geojson'}"
    file_path = os.path.join(upload_path, safe_name)
    with open(file_path, "wb") as fp:
        fp.write(content)

    try:
        ym = yield_analysis_service.process_yield_upload(
            farm_id=farm_id,
            geojson_data=geojson_data,
            season_id=season_id,
            crop_type=crop_type,
            harvest_date=harvest_date,
            file_path=file_path,
            db=db,
        )
        return _yield_dict(ym)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/yield-maps/{yield_id}")
def get_yield_map(
    yield_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ym = db.query(YieldMap).filter(YieldMap.id == yield_id).first()
    if not ym:
        raise HTTPException(404, f"Yield map {yield_id} not found")
    d = _yield_dict(ym)
    d["geojson_data"] = ym.geojson_data
    return d


@router.delete("/yield-maps/{yield_id}", status_code=204)
def delete_yield_map(
    yield_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ym = db.query(YieldMap).filter(YieldMap.id == yield_id).first()
    if not ym:
        raise HTTPException(404, f"Yield map {yield_id} not found")
    db.delete(ym)
    db.commit()
