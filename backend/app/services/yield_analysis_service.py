"""
Yield Analysis Service
=======================
Processes uploaded yield maps (GeoJSON from harvest monitors) and:
  - extracts yield values from feature properties
  - computes statistics (mean, min, max, CV, percentiles)
  - compares yield zones vs. stored productivity zones
  - persists a YieldMap record
"""
import math
from typing import Optional, List, Any
from datetime import date as DateType
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.precision_ag import YieldMap
from app.models.geo_intelligence import ProductivityZone
from app.models.farm import Farm

# Property keys tried in order when looking for yield values in GeoJSON features
_YIELD_KEYS = (
    "yield", "yield_tha", "Yield", "YIELD",
    "yield_t_ha", "dry_yield", "DRY_YIELD",
    "yld_vol_dr", "YLD_VOL_DR",            # John Deere Apex
    "yield_kg_ha",                          # kg/ha (will be divided by 1000)
)


def _extract_yield_values(geojson: dict) -> List[float]:
    """Scan all GeoJSON features and return a list of numeric yield values."""
    values: List[float] = []
    for f in geojson.get("features", []):
        props = f.get("properties", {}) or {}
        for key in _YIELD_KEYS:
            raw = props.get(key)
            if raw is None:
                continue
            try:
                v = float(raw)
                # Detect kg/ha values and convert to t/ha
                if key == "yield_kg_ha":
                    v /= 1000.0
                if v >= 0:
                    values.append(v)
                break
            except (TypeError, ValueError):
                pass
    return values


def _cv(values: List[float]) -> float:
    """Coefficient of variation (%) — measure of yield variability."""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    if mean == 0:
        return 0.0
    var = sum((v - mean) ** 2 for v in values) / len(values)
    return round(math.sqrt(var) / mean * 100, 1)


def process_yield_upload(
    farm_id: int,
    geojson_data: dict,
    season_id: Optional[int],
    crop_type: Optional[str],
    harvest_date: Optional[DateType],
    file_path: Optional[str],
    db: Session,
) -> YieldMap:
    """Parse yield GeoJSON → compute statistics → compare with zones → save."""
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise ValueError(f"Farm {farm_id} not found")

    values = _extract_yield_values(geojson_data)
    n = len(values)

    if n == 0:
        # Store the GeoJSON without statistics
        ym = YieldMap(
            farm_id=farm_id,
            season_id=season_id,
            crop_type=crop_type or farm.crop_type,
            harvest_date=harvest_date,
            file_path=file_path,
            geojson_data=geojson_data,
        )
        db.add(ym)
        db.commit()
        db.refresh(ym)
        return ym

    values_sorted = sorted(values)
    mean_v  = sum(values) / n
    p33_idx = int(n * 0.33)
    p67_idx = int(n * 0.67)
    low_cut  = values_sorted[p33_idx]
    high_cut = values_sorted[p67_idx]

    area_ha   = farm.area or max(n * 0.01, 0.1)   # crude: ~1 point per 0.01 ha
    total_kg  = mean_v * area_ha * 1_000           # t/ha × ha × 1000 → kg

    high_vals = [v for v in values if v >= high_cut]
    low_vals  = [v for v in values if v <= low_cut]

    # ── Compare with productivity zones ────────────────────────────────────
    zones = (
        db.query(ProductivityZone)
        .filter(ProductivityZone.farm_id == farm_id)
        .order_by(desc(ProductivityZone.computed_at))
        .all()
    )

    zone_comparison: dict = {}
    if zones:
        for cls in ("high", "medium", "low"):
            cls_zones = [z for z in zones if z.zone_class == cls]
            if not cls_zones:
                continue
            zone_area = sum((z.area_ha or 0) for z in cls_zones)
            zone_ndvi = sum((z.mean_ndvi or 0) for z in cls_zones) / len(cls_zones)

            # Estimate zone yield based on NDVI correlation:
            # high NDVI → higher yield; simple linear scaling around mean
            ndvi_factor = (zone_ndvi / 0.5) if zone_ndvi else 1.0
            est_yield   = round(mean_v * ndvi_factor, 2)

            zone_comparison[cls] = {
                "area_ha":           round(zone_area, 2),
                "estimated_yield_tha": est_yield,
                "mean_ndvi":         round(zone_ndvi, 3),
                "yield_gap_vs_mean": round(est_yield - mean_v, 2),
                "yield_index":       round(ndvi_factor, 2),
            }

    ym = YieldMap(
        farm_id=farm_id,
        season_id=season_id,
        crop_type=crop_type or farm.crop_type,
        harvest_date=harvest_date,
        file_path=file_path,
        geojson_data=geojson_data,
        mean_yield_tha=round(mean_v, 3),
        max_yield_tha=round(values_sorted[-1], 3),
        min_yield_tha=round(values_sorted[0], 3),
        total_yield_kg=round(total_kg, 0),
        area_harvested_ha=round(area_ha, 2),
        variability_cv=_cv(values),
        high_yield_area_ha=round(len(high_vals) / n * area_ha, 2),
        low_yield_area_ha=round(len(low_vals) / n * area_ha, 2),
        zone_comparison=zone_comparison or None,
    )
    db.add(ym)
    db.commit()
    db.refresh(ym)
    return ym
