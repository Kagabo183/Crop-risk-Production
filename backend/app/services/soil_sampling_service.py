"""
Soil Sampling Service
======================
Generates soil sampling zone layouts for a farm:

  grid   — evenly-spaced sample points across the farm polygon
  zone   — one centroid sample per productivity zone
  random — stratified random points (falls back to grid)

Also handles bulk upload of nutrient analysis results.
"""
import math
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models.precision_ag import SoilSample, SoilNutrientResult, SamplingMethod
from app.models.farm import Farm
from app.models.geo_intelligence import ProductivityZone


# ─── Geometry helpers ────────────────────────────────────────────────────────

def _farm_shape(farm: Farm):
    """Return a shapely geometry for the farm boundary, or None."""
    try:
        from shapely import wkb
        if farm.boundary:
            return wkb.loads(bytes(farm.boundary.data))
    except Exception:
        pass
    try:
        from shapely.geometry import box
        lat, lon = farm.latitude or -1.95, farm.longitude or 30.06
        d = 0.003  # ~330 m
        return box(lon - d, lat - d, lon + d, lat + d)
    except Exception:
        return None


def _fallback_grid(farm: Farm, grid_size_m: int) -> List[dict]:
    """Return a regular grid around the farm centroid (shapely unavailable)."""
    lat  = farm.latitude  or -1.95
    lon  = farm.longitude or 30.06
    area = farm.area      or 1.0
    side = math.sqrt(area * 10_000)        # metres
    n    = max(1, int(side / grid_size_m))
    d_lon = grid_size_m / 111_320
    d_lat = grid_size_m / 110_540

    points, idx = [], 1
    for i in range(n):
        for j in range(n):
            points.append({
                "id":    idx,
                "lat":   round(lat + (i - n / 2) * d_lat, 6),
                "lon":   round(lon + (j - n / 2) * d_lon, 6),
                "label": f"S{idx:03d}",
            })
            idx += 1
    return points


def _to_geojson_fc(points: List[dict], method: str) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "properties": {
                    "id":         p["id"],
                    "label":      p["label"],
                    "method":     method,
                    "zone_class": p.get("zone_class"),
                },
            }
            for p in points
        ],
    }


# ─── Grid sampling ────────────────────────────────────────────────────────────

def generate_grid_sampling(
    farm_id: int,
    grid_size_m: int,
    db: Session,
    notes: Optional[str] = None,
) -> SoilSample:
    """Place sampling points on a regular grid within the farm polygon."""
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise ValueError(f"Farm {farm_id} not found")

    shape = _farm_shape(farm)
    points: List[dict] = []

    if shape is not None:
        try:
            from shapely.geometry import Point
            minx, miny, maxx, maxy = shape.bounds
            mid_lat    = (miny + maxy) / 2
            d_lon      = grid_size_m / (111_320 * math.cos(math.radians(mid_lat)))
            d_lat      = grid_size_m / 110_540

            x, idx = minx + d_lon / 2, 1
            while x < maxx:
                y = miny + d_lat / 2
                while y < maxy:
                    if shape.contains(Point(x, y)):
                        points.append({"id": idx, "lat": round(y, 6), "lon": round(x, 6), "label": f"S{idx:03d}"})
                        idx += 1
                    y += d_lat
                x += d_lon
        except ImportError:
            points = _fallback_grid(farm, grid_size_m)
    else:
        points = _fallback_grid(farm, grid_size_m)

    if not points:
        points = [{"id": 1, "lat": farm.latitude or -1.95, "lon": farm.longitude or 30.06, "label": "S001"}]

    sample = SoilSample(
        farm_id=farm_id,
        sampling_method=SamplingMethod.grid,
        grid_size_m=grid_size_m,
        total_zones=len(points),
        sampling_geojson=_to_geojson_fc(points, "grid"),
        notes=notes,
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return sample


# ─── Zone sampling ────────────────────────────────────────────────────────────

def generate_zone_sampling(
    farm_id: int,
    db: Session,
    notes: Optional[str] = None,
) -> SoilSample:
    """Place one sample point at the centroid of each productivity zone."""
    zones = (
        db.query(ProductivityZone)
        .filter(ProductivityZone.farm_id == farm_id)
        .order_by(desc(ProductivityZone.computed_at))
        .all()
    )

    points: List[dict] = []
    for i, z in enumerate(zones):
        centroid = None
        try:
            from shapely import wkb
            if z.boundary:
                c = wkb.loads(bytes(z.boundary.data)).centroid
                centroid = {"lat": round(c.y, 6), "lon": round(c.x, 6)}
        except Exception:
            pass

        if centroid is None:
            farm = db.query(Farm).filter(Farm.id == farm_id).first()
            centroid = {"lat": farm.latitude or -1.95, "lon": farm.longitude or 30.06}

        points.append({
            "id":         i + 1,
            "label":      f"Z{i+1:02d}-{z.zone_class.upper()}",
            "zone_class": z.zone_class,
            **centroid,
        })

    if not points:
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        points = [{"id": 1, "label": "Z01-FARM", "zone_class": "unknown",
                   "lat": farm.latitude or -1.95, "lon": farm.longitude or 30.06}]

    sample = SoilSample(
        farm_id=farm_id,
        sampling_method=SamplingMethod.zone,
        total_zones=len(points),
        sampling_geojson=_to_geojson_fc(points, "zone"),
        notes=notes,
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)
    return sample


# ─── Nutrient result upload ────────────────────────────────────────────────────

def save_nutrient_results(
    soil_sample_id: int,
    results: List[Dict[str, Any]],
    db: Session,
) -> List[SoilNutrientResult]:
    """
    Bulk-insert nutrient analysis results for a soil sample.
    Each dict may contain: zone_label, lat/latitude, lon/longitude,
    nitrogen, phosphorus, potassium, organic_matter, ph, moisture, raw_data.
    """
    try:
        from geoalchemy2.shape import from_shape
        from shapely.geometry import Point
        use_geo = True
    except ImportError:
        use_geo = False

    saved = []
    for r in results:
        lat = r.get("lat") or r.get("latitude")
        lon = r.get("lon") or r.get("longitude")
        point_geom = None
        if use_geo and lat is not None and lon is not None:
            try:
                point_geom = from_shape(Point(float(lon), float(lat)), srid=4326)
            except Exception:
                pass

        nr = SoilNutrientResult(
            soil_sample_id=soil_sample_id,
            zone_label=r.get("zone_label"),
            latitude=lat,
            longitude=lon,
            point=point_geom,
            nitrogen=r.get("nitrogen"),
            phosphorus=r.get("phosphorus"),
            potassium=r.get("potassium"),
            organic_matter=r.get("organic_matter"),
            ph=r.get("ph"),
            moisture=r.get("moisture"),
            raw_data=r.get("raw_data"),
        )
        db.add(nr)
        saved.append(nr)

    db.commit()
    for nr in saved:
        db.refresh(nr)
    return saved


def get_nutrient_summary(soil_sample_id: int, db: Session) -> dict:
    """Return min/mean/max for each nutrient across sample results."""
    results = (
        db.query(SoilNutrientResult)
        .filter(SoilNutrientResult.soil_sample_id == soil_sample_id)
        .all()
    )
    if not results:
        return {}

    def _stats(attr):
        vals = [getattr(r, attr) for r in results if getattr(r, attr) is not None]
        if not vals:
            return None
        return {"min": round(min(vals), 2), "mean": round(sum(vals) / len(vals), 2), "max": round(max(vals), 2)}

    return {
        "nitrogen":      _stats("nitrogen"),
        "phosphorus":    _stats("phosphorus"),
        "potassium":     _stats("potassium"),
        "organic_matter": _stats("organic_matter"),
        "ph":            _stats("ph"),
        "moisture":      _stats("moisture"),
        "n_samples":     len(results),
    }
