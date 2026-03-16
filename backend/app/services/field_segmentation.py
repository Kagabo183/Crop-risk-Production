"""
Field Segmentation Service
---------------------------
Automatically detects agricultural field boundaries from Sentinel-2 imagery
using Google Earth Engine's SNIC (Simple Non-Iterative Clustering) superpixel
segmentation + NDVI thresholding.

Pipeline:
  1. Check PostGIS cache by tile_key (TTL = 7 days)
  2. If stale / absent → run GEE pipeline:
       S2_SR_HARMONIZED → NDVI → veg mask → SNIC → reduceToVectors → filter
  3. Persist results in detected_fields table
  4. Return GeoJSON FeatureCollection

Inputs:
  bbox  – [west, south, east, north]  (WGS-84 degrees)
  zoom  – Leaflet zoom (must >= 11)

Limits:
  Max bbox area: ~0.25 sq-deg (~625 km² at equator) to keep GEE calls fast.
  Results cached for 7 days before being refreshed.
"""
import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.geo_intelligence import DetectedField
from app.core import gee_manager

logger = logging.getLogger(__name__)

# ── Tunables ──────────────────────────────────────────────────────────────────

_SNIC_SIZE          = 16      # Superpixel target size in pixels
_SNIC_COMPACTNESS   = 1       # High = more square superpixels
_SNIC_CONNECTIVITY  = 8       # 4 | 8
_NDVI_THRESHOLD     = 0.15    # Min NDVI to count as vegetation
_MIN_AREA_M2        = 1_000   # 0.1 ha — drop tiny slivers
_MAX_AREA_M2        = 5_000_000  # 500 ha — drop huge mis-segments
_CLOUD_MAX_PCT      = 20      # Max cloud cover for S2 scene
_SCALE_M            = 10      # S2 native resolution
_CACHE_DAYS         = 7       # Days before a cached result expires
_BBOX_MAX_DEG       = 0.5     # Each dimension capped at 0.5° to control cost


class FieldSegmentationService:
    """Detect agricultural field polygons for a map viewport bounding box."""

    # ── Public entry ─────────────────────────────────────────────────────────

    def detect_fields(
        self,
        bbox: List[float],
        zoom: int,
        db: Session,
    ) -> Dict[str, Any]:
        """
        Return a GeoJSON FeatureCollection of detected field polygons.

        Parameters
        ----------
        bbox : [west, south, east, north]
        zoom : Leaflet zoom level (rejected below 11)
        db   : SQLAlchemy session

        Returns
        -------
        {
            "type": "FeatureCollection",
            "features": [...],
            "cached": bool,
            "count":  int,
            "source": "cache" | "gee" | "gee_unavailable",
            "date":   ISO date string | null,
        }
        """
        if zoom < 11:
            return self._empty_fc("zoom_too_low")

        west, south, east, north = self._clamp_bbox(bbox)
        tile_key = self._tile_key(west, south, east, north, zoom)

        # 1. Try cache
        cached = self._load_cache(tile_key, db)
        if cached:
            return cached

        # 2. Try GEE
        if not gee_manager.is_initialized():
            return self._empty_fc("gee_unavailable")

        try:
            return self._run_gee_pipeline(west, south, east, north, tile_key, db)
        except Exception as exc:
            logger.error("Field segmentation GEE pipeline failed: %s", exc, exc_info=True)
            return self._empty_fc("gee_error")

    # ── Cache helpers ─────────────────────────────────────────────────────────

    def _tile_key(self, west: float, south: float, east: float, north: float, zoom: int) -> str:
        return f"bbox/{west:.4f},{south:.4f},{east:.4f},{north:.4f}/z{zoom}"

    def _clamp_bbox(self, bbox: List[float]) -> List[float]:
        """Clamp bbox dimensions to _BBOX_MAX_DEG to avoid runaway GEE cost."""
        west, south, east, north = bbox
        cx = (west + east) / 2
        cy = (south + north) / 2
        half = _BBOX_MAX_DEG / 2
        return [
            round(max(west,  cx - half), 6),
            round(max(south, cy - half), 6),
            round(min(east,  cx + half), 6),
            round(min(north, cy + half), 6),
        ]

    def _load_cache(self, tile_key: str, db: Session) -> Optional[Dict[str, Any]]:
        """Return cached GeoJSON if fresh records exist for this tile_key."""
        cutoff = datetime.utcnow() - timedelta(days=_CACHE_DAYS)
        rows = (
            db.query(DetectedField)
            .filter(
                DetectedField.tile_key == tile_key,
                DetectedField.created_at >= cutoff,
            )
            .all()
        )
        if not rows:
            return None

        features = [self._row_to_feature(r) for r in rows]
        return {
            "type": "FeatureCollection",
            "features": features,
            "cached": True,
            "count": len(features),
            "source": "cache",
            "date": rows[0].imagery_date.isoformat() if rows[0].imagery_date else None,
        }

    def _row_to_feature(self, row: DetectedField) -> dict:
        from geoalchemy2.shape import to_shape
        geom = to_shape(row.geometry)
        return {
            "type": "Feature",
            "geometry": json.loads(json.dumps(geom.__geo_interface__)),
            "properties": {
                "id":           row.id,
                "ndvi_mean":    round(row.ndvi_mean, 4) if row.ndvi_mean is not None else None,
                "area_ha":      round(row.area_ha, 3) if row.area_ha is not None else None,
                "imagery_date": row.imagery_date.isoformat() if row.imagery_date else None,
                "cloud_pct":    row.cloud_pct,
            },
        }

    # ── GEE pipeline ──────────────────────────────────────────────────────────

    def _run_gee_pipeline(
        self,
        west: float, south: float, east: float, north: float,
        tile_key: str,
        db: Session,
    ) -> Dict[str, Any]:
        import ee  # guarded import — only when GEE is initialised

        region = ee.Geometry.Rectangle([west, south, east, north], proj="EPSG:4326", evenOdd=False)

        # ── Sentinel-2 composite ──────────────────────────────────────────────
        end_date   = datetime.utcnow()
        start_date = end_date - timedelta(days=90)

        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(region)
            .filterDate(start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", _CLOUD_MAX_PCT))
            .sort("CLOUDY_PIXEL_PERCENTAGE")
        )

        n_images = s2.size().getInfo()
        imagery_date: Optional[date] = None
        cloud_pct: Optional[float] = None

        if n_images > 0:
            best = s2.first()
            imagery_date = date.fromtimestamp(
                best.date().getInfo()["value"] / 1000
            )
            cloud_pct = best.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()
            composite = s2.median()
        else:
            # Relax cloud filter and take most recent
            composite = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterBounds(region)
                .filterDate(start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"))
                .sort("system:time_start", False)
                .first()
            )
            if composite is None:
                return self._empty_fc("no_imagery")

        # ── NDVI + vegetation mask ────────────────────────────────────────────
        ndvi = composite.normalizedDifference(["B8", "B4"]).rename("ndvi")
        veg  = ndvi.gt(_NDVI_THRESHOLD)
        masked_ndvi = ndvi.updateMask(veg)

        # ── SNIC superpixel segmentation ──────────────────────────────────────
        snic = ee.Algorithms.Image.Segmentation.SNIC(
            image=masked_ndvi,
            size=_SNIC_SIZE,
            compactness=_SNIC_COMPACTNESS,
            connectivity=_SNIC_CONNECTIVITY,
            neighborhoodSize=_SNIC_SIZE * 2,
        )
        clusters = snic.select("clusters").rename("cluster_id")

        # Compute per-cluster NDVI mean
        cluster_with_ndvi = clusters.addBands(ndvi)

        # ── Vectorise ─────────────────────────────────────────────────────────
        vectors = cluster_with_ndvi.reduceToVectors(
            geometry=region,
            crs=ee.Projection("EPSG:4326"),
            scale=_SCALE_M,
            geometryType="polygon",
            eightConnected=(_SNIC_CONNECTIVITY == 8),
            labelProperty="cluster_id",
            reducer=ee.Reducer.mean(),
            maxPixels=int(5e7),
            bestEffort=True,
            tileScale=4,
        )

        # ── Filter by area ────────────────────────────────────────────────────
        vectors = vectors.map(lambda f: f.set("area_m2", f.geometry().area(10)))
        vectors = vectors.filter(
            ee.Filter.And(
                ee.Filter.gte("area_m2", _MIN_AREA_M2),
                ee.Filter.lte("area_m2", _MAX_AREA_M2),
            )
        )

        geojson_data = vectors.getInfo()

        if not geojson_data or "features" not in geojson_data:
            return self._empty_fc("no_features")

        # ── Convert m² to ha, persist to DB ──────────────────────────────────
        features = geojson_data["features"]
        db_rows: List[DetectedField] = []

        for feat in features:
            props = feat.get("properties", {})
            geom  = feat.get("geometry")
            if geom is None:
                continue

            area_m2   = props.get("area_m2", 0.0) or 0.0
            area_ha   = area_m2 / 10_000
            ndvi_mean = props.get("ndvi", None)

            geom_wkt = _geojson_to_wkt(geom)
            if geom_wkt is None:
                continue

            row = DetectedField(
                geometry=geom_wkt,
                ndvi_mean=ndvi_mean,
                ndvi_std=None,
                area_ha=area_ha,
                tile_key=tile_key,
                imagery_date=imagery_date,
                cloud_pct=cloud_pct,
            )
            db.add(row)
            db_rows.append(row)

        db.commit()

        # Refresh to get PostGIS geometries back
        for row in db_rows:
            db.refresh(row)

        out_features = [self._row_to_feature(r) for r in db_rows]

        return {
            "type": "FeatureCollection",
            "features": out_features,
            "cached": False,
            "count": len(out_features),
            "source": "gee",
            "date": imagery_date.isoformat() if imagery_date else None,
        }

    # ── Utility ───────────────────────────────────────────────────────────────

    @staticmethod
    def _empty_fc(reason: str = "") -> Dict[str, Any]:
        return {
            "type": "FeatureCollection",
            "features": [],
            "cached": False,
            "count": 0,
            "source": reason,
            "date": None,
        }


# ── Module-level geometry helper ──────────────────────────────────────────────

def _geojson_to_wkt(geom: dict) -> Optional[str]:
    """
    Convert a GeoJSON geometry dict to a WKT string suitable for GeoAlchemy2.
    Handles Polygon and MultiPolygon; returns None for unsupported types.
    """
    try:
        from shapely.geometry import shape, mapping
        from shapely.ops import unary_union
        s = shape(geom)
        if s.is_empty:
            return None
        # Ensure it is a single polygon (take convex hull of multipolygon)
        if s.geom_type == "MultiPolygon":
            s = s.convex_hull
        if s.geom_type not in ("Polygon", "MultiPolygon"):
            return None
        return s.wkt
    except Exception as exc:
        logger.debug("GeoJSON→WKT conversion failed: %s", exc)
        return None
