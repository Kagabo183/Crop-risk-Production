"""
Field Crop Classification Service
----------------------------------
Classifies user-drawn/promoted field polygons by crop type using:
  1. Sentinel-2 NDVI time-series growth curve analysis (via GEE)
  2. Phenology template matching (cosine similarity on feature vectors)
  3. Bayesian prior boost from declared crop type

Supported crops: maize, beans, cassava, potato, wheat, rice, sorghum, tea, coffee
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ── Crop phenology feature templates ─────────────────────────────────────────
# Feature vectors calibrated on Rwanda / East-Africa growing conditions.
# Keys must match _TEMPLATE_KEYS exactly.
CROP_TEMPLATES: Dict[str, Dict[str, float]] = {
    "maize": {
        "peak_ndvi":      0.82,
        "mean_ndvi":      0.47,
        "cv_ndvi":        0.50,
        "time_above_05":  0.28,
        "time_above_03":  0.55,
        "peak_timing":    0.38,  # peak at ~38% through the observation window
        "season_length":  0.33,  # active ~33% of year
    },
    "beans": {
        "peak_ndvi":      0.62,
        "mean_ndvi":      0.33,
        "cv_ndvi":        0.58,
        "time_above_05":  0.15,
        "time_above_03":  0.40,
        "peak_timing":    0.33,
        "season_length":  0.25,
    },
    "cassava": {
        "peak_ndvi":      0.68,
        "mean_ndvi":      0.62,
        "cv_ndvi":        0.08,
        "time_above_05":  0.75,
        "time_above_03":  0.90,
        "peak_timing":    0.50,
        "season_length":  0.85,
    },
    "potato": {
        "peak_ndvi":      0.76,
        "mean_ndvi":      0.40,
        "cv_ndvi":        0.55,
        "time_above_05":  0.22,
        "time_above_03":  0.45,
        "peak_timing":    0.35,
        "season_length":  0.27,
    },
    "wheat": {
        "peak_ndvi":      0.74,
        "mean_ndvi":      0.52,
        "cv_ndvi":        0.32,
        "time_above_05":  0.38,
        "time_above_03":  0.62,
        "peak_timing":    0.45,
        "season_length":  0.42,
    },
    "rice": {
        "peak_ndvi":      0.72,
        "mean_ndvi":      0.53,
        "cv_ndvi":        0.28,
        "time_above_05":  0.42,
        "time_above_03":  0.65,
        "peak_timing":    0.40,
        "season_length":  0.35,
    },
    "sorghum": {
        "peak_ndvi":      0.72,
        "mean_ndvi":      0.42,
        "cv_ndvi":        0.48,
        "time_above_05":  0.25,
        "time_above_03":  0.52,
        "peak_timing":    0.45,
        "season_length":  0.38,
    },
    "tea": {
        "peak_ndvi":      0.78,
        "mean_ndvi":      0.72,
        "cv_ndvi":        0.06,
        "time_above_05":  0.88,
        "time_above_03":  0.98,
        "peak_timing":    0.50,
        "season_length":  0.95,
    },
    "coffee": {
        "peak_ndvi":      0.75,
        "mean_ndvi":      0.68,
        "cv_ndvi":        0.10,
        "time_above_05":  0.82,
        "time_above_03":  0.95,
        "peak_timing":    0.50,
        "season_length":  0.90,
    },
}

_TEMPLATE_CROPS  = list(CROP_TEMPLATES.keys())
_TEMPLATE_KEYS   = [
    "peak_ndvi", "mean_ndvi", "cv_ndvi",
    "time_above_05", "time_above_03",
    "peak_timing", "season_length",
]
_TEMPLATE_MATRIX = np.array(
    [[CROP_TEMPLATES[c][k] for k in _TEMPLATE_KEYS] for c in _TEMPLATE_CROPS],
    dtype=float,
)


# ── GEE time-series extraction ────────────────────────────────────────────────

def _extract_timeseries_gee(
    geometry_wkt: str,
    days_back: int = 365,
) -> Optional[List[Dict[str, Any]]]:
    """
    Extract monthly-mean NDVI, EVI, and NDWI for a field polygon via GEE.

    Returns a list of dicts (one per calendar month covered) or None on failure.
    Each dict: {date: "YYYY-MM", ndvi: float, evi: float, ndwi: float}
    """
    try:
        import ee
        from shapely import wkt as shapely_wkt

        geom_shape = shapely_wkt.loads(geometry_wkt)
        coords     = list(geom_shape.exterior.coords)
        ee_geom    = ee.Geometry.Polygon([[[c[0], c[1]] for c in coords]])

        end   = datetime.utcnow()
        start = end - timedelta(days=days_back)

        collection = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(ee_geom)
            .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
            .select(["B3", "B4", "B8", "B8A", "B11"])
        )

        def _add_indices(img):
            eps  = 1e-9
            b3   = img.select("B3").toFloat()
            b4   = img.select("B4").toFloat()
            b8   = img.select("B8").toFloat()
            b11  = img.select("B11").toFloat()
            ndvi = b8.subtract(b4).divide(b8.add(b4).add(eps)).rename("NDVI")
            evi  = (
                b8.subtract(b4)
                .divide(b8.add(b4.multiply(6)).subtract(b3.multiply(7.5)).add(1 + eps))
                .multiply(2.5)
                .rename("EVI")
            )
            ndwi = b3.subtract(b8).divide(b3.add(b8).add(eps)).rename("NDWI")
            return img.addBands([ndvi, evi, ndwi])

        indexed = collection.map(_add_indices).select(["NDVI", "EVI", "NDWI"])

        months_list: List[Dict[str, Any]] = []
        current = start.replace(day=1)
        while current <= end:
            next_m = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
            m_col  = indexed.filterDate(
                current.strftime("%Y-%m-%d"),
                next_m.strftime("%Y-%m-%d"),
            )
            mean_vals = (
                m_col.mean()
                .reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=ee_geom,
                    scale=100,
                    maxPixels=1_000_000_000,
                    bestEffort=True,
                )
                .getInfo()
            )
            if mean_vals and mean_vals.get("NDVI") is not None:
                months_list.append(
                    {
                        "date": current.strftime("%Y-%m"),
                        "ndvi": round(float(mean_vals.get("NDVI") or 0), 4),
                        "evi":  round(float(mean_vals.get("EVI")  or 0), 4),
                        "ndwi": round(float(mean_vals.get("NDWI") or 0), 4),
                    }
                )
            current = next_m

        return months_list if len(months_list) >= 3 else None

    except Exception as exc:
        logger.warning("GEE time-series extraction failed: %s", exc)
        return None


# ── Feature computation ───────────────────────────────────────────────────────

def _compute_curve_features(timeseries: List[Dict[str, Any]]) -> Dict[str, float]:
    """Compute phenology-based feature vector from an NDVI time series."""
    ndvi_vals = [float(pt["ndvi"]) for pt in timeseries if pt.get("ndvi") is not None]
    if not ndvi_vals:
        return {}

    arr  = np.array(ndvi_vals, dtype=float)
    n    = len(arr)

    peak_ndvi   = float(arr.max())
    mean_ndvi   = float(arr.mean())
    std_ndvi    = float(arr.std())
    cv_ndvi     = std_ndvi / (mean_ndvi + 1e-9)
    peak_idx    = int(arr.argmax())
    peak_timing = peak_idx / max(n - 1, 1)

    time_above_05 = float((arr >= 0.5).sum() / n)
    time_above_03 = float((arr >= 0.3).sum() / n)
    season_length = time_above_03  # proxy for active-growth fraction

    rising_rate  = (arr[peak_idx] - arr[0]) / max(peak_idx, 1)
    falling_rate = (arr[peak_idx] - arr[-1]) / max(n - 1 - peak_idx, 1)

    return {
        "peak_ndvi":      round(peak_ndvi, 4),
        "mean_ndvi":      round(mean_ndvi, 4),
        "cv_ndvi":        round(float(cv_ndvi), 4),
        "time_above_05":  round(time_above_05, 4),
        "time_above_03":  round(time_above_03, 4),
        "peak_timing":    round(peak_timing, 4),
        "season_length":  round(season_length, 4),
        "rising_rate":    round(float(rising_rate), 4),
        "falling_rate":   round(float(falling_rate), 4),
        "n_observations": n,
    }


# ── Template matching ─────────────────────────────────────────────────────────

def _match_crop_templates(features: Dict[str, float]) -> Dict[str, float]:
    """
    Compute cosine similarity between the extracted feature vector and each crop
    template. Returns a probability-like dict {crop: score} that sums to 1.
    """
    vec      = np.array([features.get(k, 0.0) for k in _TEMPLATE_KEYS], dtype=float)
    vec_norm = float(np.linalg.norm(vec))

    if vec_norm < 1e-9:
        uniform = 1.0 / len(_TEMPLATE_CROPS)
        return {c: uniform for c in _TEMPLATE_CROPS}

    sims: Dict[str, float] = {}
    for i, crop in enumerate(_TEMPLATE_CROPS):
        t_vec     = _TEMPLATE_MATRIX[i]
        t_norm    = float(np.linalg.norm(t_vec))
        sim       = float(np.dot(vec, t_vec)) / (vec_norm * t_norm + 1e-9)
        sims[crop] = max(0.0, sim)

    total = sum(sims.values()) + 1e-9
    return {c: round(v / total, 4) for c, v in sims.items()}


# ── Growth stage inference ────────────────────────────────────────────────────

def _infer_growth_stage(
    timeseries: List[Dict[str, Any]],
    features:   Dict[str, float],
) -> Tuple[str, float]:
    """
    Determine the current growth stage from the recent NDVI trend.
    Returns (stage_name, confidence_0_1).
    """
    if not timeseries:
        return "unknown", 0.0

    ndvi_vals    = [float(pt["ndvi"]) for pt in timeseries if pt.get("ndvi") is not None]
    n            = len(ndvi_vals)
    if n < 2:
        return "unknown", 0.0

    current_ndvi = ndvi_vals[-1]
    window       = min(3, n)
    recent_slope = (ndvi_vals[-1] - ndvi_vals[-window]) / window
    peak_ndvi    = features.get("peak_ndvi", 0.5)

    if current_ndvi < 0.20:
        return "fallow_or_bare", 0.85

    if recent_slope > 0.04 and current_ndvi < 0.40:
        return "emergence", 0.78

    if recent_slope > 0.02 and current_ndvi >= 0.40:
        return "vegetative", 0.82

    if abs(recent_slope) <= 0.02 and current_ndvi >= peak_ndvi * 0.85:
        return "flowering", 0.76

    if recent_slope < -0.02 and current_ndvi >= 0.40:
        return "grain_filling", 0.72

    if recent_slope < -0.04 and current_ndvi < 0.45:
        return "maturity", 0.78

    if current_ndvi >= 0.50:
        return "vegetative", 0.62

    return "emergence", 0.55


# ── Public API ────────────────────────────────────────────────────────────────

def classify_field(
    geometry_wkt:  str,
    declared_crop: Optional[str] = None,
    prior_weight:  float = 0.15,
    days_back:     int   = 365,
) -> Dict[str, Any]:
    """
    Classify a field polygon by crop type.

    Args:
        geometry_wkt:   WKT POLYGON in WGS-84 (EPSG:4326)
        declared_crop:  Already-stated crop type (acts as Bayesian prior)
        prior_weight:   Score bonus added to the declared crop (0–1)
        days_back:      Number of days of Sentinel-2 history to fetch

    Returns a dict with keys:
        predicted_crop, confidence, all_scores,
        growth_stage, stage_confidence,
        ndvi_timeseries, curve_features, source
    """
    from app.core import gee_manager

    # Lazy init — retry if startup failed (e.g. reload race condition)
    if not gee_manager.is_initialized():
        gee_manager.initialize()

    timeseries = None
    source     = "template_only"

    if gee_manager.is_initialized():
        timeseries = _extract_timeseries_gee(geometry_wkt, days_back)
        if timeseries:
            source = "gee_curve"

    if timeseries and len(timeseries) >= 3:
        curve_features               = _compute_curve_features(timeseries)
        crop_scores                  = _match_crop_templates(curve_features)
        growth_stage, stage_conf     = _infer_growth_stage(timeseries, curve_features)
    else:
        # No imagery — fall back to uniform prior
        uniform        = 1.0 / len(CROP_TEMPLATES)
        crop_scores    = {c: uniform for c in CROP_TEMPLATES}
        curve_features = {}
        growth_stage, stage_conf = "unknown", 0.0
        if not timeseries:
            source = "no_imagery"

    # Bayesian prior boost for declared crop
    if declared_crop:
        norm = declared_crop.lower().split(",")[0].strip()
        if norm in crop_scores:
            crop_scores[norm] = crop_scores[norm] + prior_weight
            total = sum(crop_scores.values()) + 1e-9
            crop_scores = {c: round(v / total, 4) for c, v in crop_scores.items()}

    predicted  = max(crop_scores, key=crop_scores.get)
    confidence = crop_scores[predicted]

    return {
        "predicted_crop":   predicted,
        "confidence":       round(float(confidence), 4),
        "all_scores":       {
            k: round(float(v), 4)
            for k, v in sorted(crop_scores.items(), key=lambda x: -x[1])
        },
        "growth_stage":     growth_stage,
        "stage_confidence": round(float(stage_conf), 3),
        "ndvi_timeseries":  timeseries,
        "curve_features":   curve_features,
        "source":           source,
    }


def classify_farm(farm_id: int, db) -> Optional[Dict[str, Any]]:
    """Classify a Farm polygon and persist AI crop detection results back to the Farm row.

    Builds the geometry WKT from the farm boundary (or a centroid buffer as fallback),
    calls classify_field(), then saves predicted_crop, confidence, growth_stage, and
    last_satellite_date to the farms table.
    """
    from app.models.farm import Farm
    from datetime import date as _date

    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        return None

    geom_wkt: Optional[str] = None

    if farm.boundary is not None:
        try:
            from geoalchemy2.shape import to_shape
            geom_wkt = to_shape(farm.boundary).wkt
        except Exception:
            geom_wkt = None

    if not geom_wkt and farm.latitude is not None and farm.longitude is not None:
        from shapely.geometry import Point
        geom_wkt = Point(float(farm.longitude), float(farm.latitude)).buffer(0.005).wkt

    if not geom_wkt:
        return None

    result = classify_field(geom_wkt, declared_crop=farm.crop_type)

    farm.detected_crop          = result["predicted_crop"]
    farm.crop_confidence        = result["confidence"]
    farm.detected_growth_stage  = result["growth_stage"]
    farm.last_satellite_date    = _date.today()

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    return result
