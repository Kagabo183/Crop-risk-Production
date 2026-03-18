"""
Fast Vegetation Scan Service — synchronous GEE metrics-only pipeline.

Calls Google Earth Engine reduceRegion() directly and returns results in a
single HTTP round-trip (target < 3 s).  No Celery, no raster downloads.
"""
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import date, datetime, timedelta
from typing import Optional

import ee
from geoalchemy2.shape import to_shape
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.data import FarmVegetationMetric, SatelliteImage, VegetationHealth
from app.models.farm import Farm

logger = logging.getLogger(__name__)

# Hard timeout for any single GEE request (seconds)
GEE_TIMEOUT_S = int(getattr(settings, 'GEE_QUICK_SCAN_TIMEOUT_S', 60))


def _health_score(ndvi: float, ndre: float, evi: float, savi: float) -> float:
    """Composite health score (0-100) matching AutoCropRiskService weights."""
    score = 0.0
    if ndvi is not None:
        score += min(max(ndvi, 0), 1) * 100 * 0.40
    if ndre is not None:
        score += min(max(ndre, 0), 1) * 100 * 0.20
    if evi is not None:
        score += min(max(evi, 0), 1) * 100 * 0.25
    if savi is not None:
        score += min(max(savi, 0), 1) * 100 * 0.15
    return round(score, 2)


def quick_scan(farm_id: int, db: Session, days_back: int = 30) -> dict:
    """
    Run a fast, synchronous vegetation scan for *farm_id*.

    Architecture: ONE single GEE .getInfo() round-trip.
    Everything — collection selection, fallback to 90 days, median composite,
    NDVI/NDRE/EVI/SAVI reduceRegion, cloud cover — is evaluated server-side in a
    single ee.Dictionary.getInfo() call. This keeps total latency < 3 s on warm GEE.

    Raises ValueError / RuntimeError on expected error paths.
    """
    from app.core import gee_manager

    if not gee_manager.is_initialized():
        gee_manager.initialize()
    if not gee_manager.is_initialized():
        raise RuntimeError("Google Earth Engine is not available")

    farm: Optional[Farm] = db.query(Farm).filter(Farm.id == farm_id).first()
    if farm is None:
        raise ValueError(f"Farm {farm_id} not found")

    # ── Build geometry ──────────────────────────────────────────────────
    region = None
    if farm.boundary:
        try:
            shapely_geom = to_shape(farm.boundary)
            geojson = json.loads(json.dumps(shapely_geom.__geo_interface__))
            region = ee.Geometry(geojson)
        except Exception as exc:
            logger.warning("Could not use farm boundary, falling back to point buffer: %s", exc)

    if region is None:
        if not farm.latitude or not farm.longitude:
            raise ValueError("Farm has no coordinates or boundary")
        # Use 100m buffer to ensure enough pixels even for tiny farms
        region = ee.Geometry.Point([farm.longitude, farm.latitude]).buffer(100)

    # ── Helper: run any callable in a thread with hard timeout ──────────
    def _gee(fn, label: str):
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(fn)
            try:
                return fut.result(timeout=GEE_TIMEOUT_S)
            except FuturesTimeoutError:
                raise RuntimeError(
                    f"GEE request '{label}' timed out after {GEE_TIMEOUT_S}s"
                )

    # ── Build both candidate collections server-side ────────────────────
    end_dt = datetime.utcnow()
    start_30 = (end_dt - timedelta(days=max(days_back, 30))).strftime("%Y-%m-%d")
    start_90 = (end_dt - timedelta(days=90)).strftime("%Y-%m-%d")
    end_str  = end_dt.strftime("%Y-%m-%d")

    logger.info("STEP 1: Fetching imagery for farm %s", farm_id)

    col_primary = (
        ee.ImageCollection("COPERNICUS/S2_SR")
        .filterBounds(region)
        .filterDate(start_30, end_str)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
        .sort("CLOUDY_PIXEL_PERCENTAGE")
    )
    col_fallback = (
        ee.ImageCollection("COPERNICUS/S2_SR")
        .filterBounds(region)
        .filterDate(start_90, end_str)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
        .sort("CLOUDY_PIXEL_PERCENTAGE")
    )

    # Server-side pick: use primary if non-empty, else fallback
    best_col = ee.ImageCollection(
        ee.Algorithms.If(col_primary.size().gt(0), col_primary, col_fallback)
    )

    composite = best_col.median()

    # ── Compute indices ─────────────────────────────────────────────────
    logger.info("STEP 2: Computing NDVI for farm %s", farm_id)

    sf = 10000  # S2 SR DN → reflectance
    nir      = composite.select("B8").divide(sf)
    red      = composite.select("B4").divide(sf)
    red_edge = composite.select("B5").divide(sf)
    blue     = composite.select("B2").divide(sf)

    ndvi = nir.subtract(red).divide(nir.add(red)).rename("NDVI")
    ndre = nir.subtract(red_edge).divide(nir.add(red_edge)).rename("NDRE")
    evi  = (
        nir.subtract(red)
        .divide(nir.add(red.multiply(6)).subtract(blue.multiply(7.5)).add(1))
        .multiply(2.5)
        .rename("EVI")
    )
    L = 0.5
    savi = nir.subtract(red).divide(nir.add(red).add(L)).multiply(1 + L).rename("SAVI")

    # NDWI: (Green - NIR) / (Green + NIR) — water content index
    green = composite.select("B3").divide(sf)
    ndwi = green.subtract(nir).divide(green.add(nir)).rename("NDWI")

    indices = ee.Image.cat([ndvi, ndre, evi, savi, ndwi])

    # ── ONE single round-trip: stats + size + cloud cover ───────────────
    combined = ee.Dictionary({
        "n": best_col.size(),
        "cloud": best_col.first().get("CLOUDY_PIXEL_PERCENTAGE"),
        "stats": indices.reduceRegion(
            reducer=(
                ee.Reducer.mean()
                .combine(ee.Reducer.minMax(), sharedInputs=True)
                .combine(ee.Reducer.stdDev(), sharedInputs=True)
            ),
            geometry=region,
            scale=20,          # 20 m — 4× fewer pixels, negligible accuracy loss
            maxPixels=1e9,
            bestEffort=True,
        ),
    })

    result_raw = _gee(combined.getInfo, "combined_scan")

    size      = int(result_raw.get("n", 0))
    cloud_pct = result_raw.get("cloud")
    stats     = result_raw.get("stats") or {}

    if size == 0:
        raise ValueError("No Sentinel-2 imagery available for this location/period")

    ndvi_mean = stats.get("NDVI_mean")
    ndvi_min  = stats.get("NDVI_min")
    ndvi_max  = stats.get("NDVI_max")
    ndvi_std  = stats.get("NDVI_stdDev")
    ndre_mean = stats.get("NDRE_mean")
    evi_mean  = stats.get("EVI_mean")
    savi_mean = stats.get("SAVI_mean")
    ndwi_mean = stats.get("NDWI_mean")

    health = _health_score(ndvi_mean, ndre_mean, evi_mean, savi_mean)

    # ── Persist ─────────────────────────────────────────────────────────
    logger.info("STEP 3: Saving to DB for farm %s (NDVI=%.4f)", farm_id, ndvi_mean or 0)
    today = date.today()
    metric = (
        db.query(FarmVegetationMetric)
        .filter(
            FarmVegetationMetric.farm_id == farm_id,
            FarmVegetationMetric.observation_date == today,
        )
        .first()
    )
    if metric is None:
        metric = FarmVegetationMetric(farm_id=farm_id, observation_date=today)
        db.add(metric)

    metric.ndvi_mean           = ndvi_mean
    metric.ndvi_min            = ndvi_min
    metric.ndvi_max            = ndvi_max
    metric.ndvi_std            = ndvi_std
    metric.ndre_mean           = ndre_mean
    metric.evi_mean            = evi_mean
    metric.savi_mean           = savi_mean
    metric.cloud_cover_percent = cloud_pct
    metric.health_score        = health
    metric.source              = "gee_quick_scan"

    # Also create/update SatelliteImage record (used by early_warning, admin, etc.)
    sat_img = (
        db.query(SatelliteImage)
        .filter(SatelliteImage.farm_id == farm_id, SatelliteImage.date == today)
        .first()
    )
    if sat_img is None:
        sat_img = SatelliteImage(
            farm_id=farm_id,
            date=today,
            region=farm.location or "Unknown",
            image_type="multispectral",
            file_path=f"gee_quick_scan/farm_{farm_id}/{today}",
            source="gee_quick_scan",
            processing_status="completed",
        )
        db.add(sat_img)
    sat_img.mean_ndvi = ndvi_mean
    sat_img.mean_ndre = ndre_mean
    sat_img.mean_ndwi = ndwi_mean
    sat_img.mean_evi  = evi_mean
    sat_img.mean_savi = savi_mean
    sat_img.cloud_cover_percent = cloud_pct

    # Also create/update VegetationHealth record (used by stress monitoring)
    vh = (
        db.query(VegetationHealth)
        .filter(VegetationHealth.farm_id == farm_id, VegetationHealth.date == today)
        .first()
    )
    if vh is None:
        vh = VegetationHealth(farm_id=farm_id, date=today)
        db.add(vh)
    vh.ndvi = ndvi_mean
    vh.ndre = ndre_mean
    vh.ndwi = ndwi_mean
    vh.evi  = evi_mean
    vh.savi = savi_mean
    vh.health_score = health
    vh.stress_level = "low" if health >= 60 else ("moderate" if health >= 35 else "high")

    db.commit()
    db.refresh(metric)

    logger.info("STEP 4: Completed for farm %s — NDVI=%.4f health=%.1f", farm_id, ndvi_mean or 0, health)

    return {
        "farm_id":             farm_id,
        "observation_date":    str(today),
        "ndvi_mean":           _round(ndvi_mean),
        "ndvi_min":            _round(ndvi_min),
        "ndvi_max":            _round(ndvi_max),
        "ndvi_std":            _round(ndvi_std),
        "ndre_mean":           _round(ndre_mean),
        "evi_mean":            _round(evi_mean),
        "savi_mean":           _round(savi_mean),
        "ndwi_mean":           _round(ndwi_mean),
        "cloud_cover_percent": _round(cloud_pct),
        "health_score":        health,
        "source":              "gee_quick_scan",
        "images_found":        size,
    }


def _round(v, n=4):
    return round(v, n) if v is not None else None
