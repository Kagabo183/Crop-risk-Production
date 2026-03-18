"""
NDVI Tile Service
-----------------
Generates NDVI visualization tiles for Leaflet overlays.

Primary backend:  Google Earth Engine → signed XYZ tile URL usable directly
                  in L.tileLayer / <TileLayer url={...} />

Fallback:         Latest VegetationHealth record → color hex + bounds metadata
                  (frontend renders a coloured polygon overlay instead of a tile layer)

Colour scale (red → yellow → green):
  NDVI < 0.1   → #F44336  (bare soil / severe stress)
  0.1 – 0.2    → #FF5722
  0.2 – 0.3    → #FFC107
  0.3 – 0.5    → #CDDC39
  0.5 – 0.6    → #8BC34A
  ≥ 0.6        → #4CAF50  (healthy dense vegetation)
"""
import logging
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.farm import Farm
from app.models.data import VegetationHealth
from app.models.geo_intelligence import NdviOverlay
from app.core import gee_manager

logger = logging.getLogger(__name__)

# GEE colour palette (hex strings, no '#')
NDVI_PALETTE = ["F44336", "FF5722", "FFC107", "CDDC39", "8BC34A", "4CAF50"]
NDVI_VIS = {"min": 0.0, "max": 0.75, "palette": NDVI_PALETTE}

# Per-index vis params  (NDRE and SAVI tend to be lower range)
INDEX_VIS = {
    "NDVI": {"min": -0.1, "max": 0.8,  "palette": NDVI_PALETTE},
    "NDRE": {"min": -0.1, "max": 0.5,  "palette": NDVI_PALETTE},
    "EVI":  {"min": -0.1, "max": 0.8,  "palette": NDVI_PALETTE},
    "SAVI": {"min": -0.1, "max": 0.75, "palette": NDVI_PALETTE},
}

# MSAVI visual palette (same red→green)
MSAVI_PALETTE = NDVI_PALETTE
MSAVI_VIS = {"min": 0.0, "max": 0.75, "palette": MSAVI_PALETTE}


class NdviTileService:
    """Generate NDVI tile overlay info for Leaflet map rendering."""

    def get_ndvi_tile_info(
        self,
        farm: Farm,
        db: Session,
        days_back: int = 30,
        index: str = "NDVI",
    ) -> Dict[str, Any]:
        """
        Return vegetation index overlay information for a farm.

        Parameters
        ----------
        index : NDVI | NDRE | EVI | SAVI

        Returns dict containing:
          tile_url   – str | None   GEE/PC tile URL template (use {z}/{x}/{y})
          bounds     – [[lat_s, lon_w], [lat_n, lon_e]]
          mean_ndvi  – float
          source     – 'gee' | 'fallback'
          date       – ISO date string
          color_hex  – str  (fallback only)
        """
        if not (farm.latitude and farm.longitude):
            return self._empty_response(farm)

        idx = index.upper() if index else "NDVI"
        if idx not in ("NDVI", "NDRE", "EVI", "SAVI"):
            idx = "NDVI"

        if gee_manager.is_initialized():
            try:
                return self._get_gee_tiles(farm, days_back, idx)
            except Exception as exc:
                logger.warning(
                    "GEE tile generation failed for farm %s: %s", farm.id, exc
                )

        return self._get_fallback_info(farm, db)

    # ── GEE path ────────────────────────────────────────────────────────────────

    def _get_gee_tiles(self, farm: Farm, days_back: int, index: str = "NDVI") -> Dict[str, Any]:
        import ee  # Import guarded – only available when GEE is initialised

        end = datetime.utcnow()
        start = end - timedelta(days=days_back)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        farm_geom, bounds_sw, bounds_ne = self._build_geom(farm)
        if farm_geom is None:
            raise ValueError(f"Could not build GEE geometry for farm {farm.id} (lat={farm.latitude}, lon={farm.longitude})")

        # Sentinel-2 SR collection
        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(farm_geom)
            .filterDate(start_str, end_str)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
        )

        count = s2.size().getInfo()
        img    = s2.median() if count > 0 else None
        source = "gee_sentinel2" if count > 0 else None

        if img is None:
            # Landsat-9 fallback (NDVI only)
            lc9 = (
                ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
                .filterBounds(farm_geom)
                .filterDate(start_str, end_str)
            )
            img    = lc9.median()
            source = "gee_landsat9"

            index_image = img.normalizedDifference(["SR_B5", "SR_B4"]).rename("result")
        elif index == "NDVI":
            index_image = img.normalizedDifference(["B8", "B4"]).rename("result")
        elif index == "NDRE":
            # Red-Edge Normalized Difference Vegetation Index
            index_image = img.normalizedDifference(["B8A", "B5"]).rename("result")
        elif index == "EVI":
            # Enhanced Vegetation Index (Sentinel-2 scaled bands: DN / 10000)
            # EVI = 2.5 * (NIR - R) / (NIR + 6*R - 7.5*B + 1)  [using reflectance 0-1]
            index_image = img.expression(
                "2.5 * ((NIR - R) / (NIR + 6.0 * R - 7.5 * B + 1.0))",
                {
                    "NIR": img.select("B8").divide(10000),
                    "R":   img.select("B4").divide(10000),
                    "B":   img.select("B2").divide(10000),
                }
            ).rename("result")
        elif index == "SAVI":
            # Soil Adjusted Vegetation Index  L=0.5
            index_image = img.expression(
                "1.5 * ((NIR - R) / (NIR + R + 0.5))",
                {
                    "NIR": img.select("B8").divide(10000),
                    "R":   img.select("B4").divide(10000),
                }
            ).rename("result")
        else:
            index_image = img.normalizedDifference(["B8", "B4"]).rename("result")

        # mean value statistic for the index
        mean_dict = index_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=farm_geom,
            scale=30,
            maxPixels=1_000_000,
        ).getInfo()
        mean_val = float(mean_dict.get("result") or 0.3)

        # Clip to farm geometry so only the farm area is rendered (remove full-scene cloud haze)
        index_image = index_image.clip(farm_geom)

        # Tile URL with per-index vis params
        vis = INDEX_VIS.get(index, INDEX_VIS["NDVI"])
        map_id    = index_image.getMapId(vis)
        tile_url  = map_id["tile_fetcher"].url_format

        return {
            "tile_url":  tile_url,
            "bounds":    [bounds_sw, bounds_ne],
            "mean_ndvi": round(mean_val, 4),
            "source":    source,
            "date":      end_str,
            "index":     index,
        }

    # ── DB fallback path ─────────────────────────────────────────────────────────

    def _get_fallback_info(self, farm: Farm, db: Session) -> Dict[str, Any]:
        latest = (
            db.query(VegetationHealth)
            .filter(VegetationHealth.farm_id == farm.id)
            .order_by(VegetationHealth.date.desc())
            .first()
        )
        mean_ndvi = float((latest.ndvi if latest and latest.ndvi is not None else 0.0))
        _, bounds_sw, bounds_ne = self._build_geom_fallback(farm)

        return {
            "tile_url": None,
            "bounds": [bounds_sw, bounds_ne],
            "mean_ndvi": round(mean_ndvi, 4),
            "source": "fallback",
            "date": (
                latest.date.isoformat()
                if latest and latest.date
                else date.today().isoformat()
            ),
            "color_hex": self._ndvi_to_color(mean_ndvi),
        }

    def _empty_response(self, farm: Farm) -> Dict[str, Any]:
        return {
            "tile_url": None,
            "bounds": None,
            "mean_ndvi": None,
            "source": "no_coordinates",
            "date": date.today().isoformat(),
        }

    # ── Helpers ──────────────────────────────────────────────────────────────────

    def _build_geom(self, farm: Farm):
        """Build GEE geometry, sw/ne bounds from farm boundary or centroid buffer."""
        import ee

        if farm.boundary is not None:
            try:
                from geoalchemy2.shape import to_shape
                shapely_geom = to_shape(farm.boundary)
                coords = list(shapely_geom.exterior.coords)
                geom = ee.Geometry.Polygon([[[c[0], c[1]] for c in coords]])
                minx, miny, maxx, maxy = shapely_geom.bounds
                return geom, [miny, minx], [maxy, maxx]
            except Exception:
                pass

        return self._build_geom_fallback(farm)

    def _build_geom_fallback(self, farm: Farm):
        """500 m buffer around centroid."""
        try:
            import ee
            lat = farm.latitude or -1.95
            lon = farm.longitude or 29.87
            geom = ee.Geometry.Point([lon, lat]).buffer(500)
        except Exception:
            geom = None
        delta = 0.005
        lat = farm.latitude or -1.95
        lon = farm.longitude or 29.87
        return geom, [lat - delta, lon - delta], [lat + delta, lon + delta]

    @staticmethod
    def _ndvi_to_color(ndvi: float) -> str:
        if ndvi >= 0.6:
            return "#4CAF50"
        if ndvi >= 0.5:
            return "#8BC34A"
        if ndvi >= 0.3:
            return "#CDDC39"
        if ndvi >= 0.2:
            return "#FFC107"
        if ndvi >= 0.1:
            return "#FF5722"
        return "#F44336"

    # ── Tile caching ───────────────────────────────────────────────────────────

    def cache_tile_result(
        self,
        farm: Farm,
        result: Dict[str, Any],
        db: Session,
    ) -> None:
        """
        Persist a tile generation result to the ndvi_overlays table so that
        the frontend can retrieve historical tile URLs for a time slider.
        Only saves when a real tile_url was generated (not fallback).
        """
        if not result.get("tile_url"):
            return   # Don't cache empty fallback results

        try:
            obs_date = date.fromisoformat(result.get("date") or date.today().isoformat())
            bounds = result.get("bounds")

            # Avoid duplicates: one record per farm per date
            existing = (
                db.query(NdviOverlay)
                .filter(
                    NdviOverlay.farm_id == farm.id,
                    NdviOverlay.date == obs_date,
                )
                .first()
            )

            if existing:
                existing.tile_url_template = result["tile_url"]
                existing.mean_ndvi = result.get("mean_ndvi")
                existing.source = result.get("source", "gee")
                existing.bounds = bounds
                existing.generated_at = datetime.utcnow()
            else:
                db.add(NdviOverlay(
                    farm_id=farm.id,
                    date=obs_date,
                    tile_url_template=result["tile_url"],
                    bounds=bounds,
                    mean_ndvi=result.get("mean_ndvi"),
                    source=result.get("source", "gee"),
                    generated_at=datetime.utcnow(),
                ))

            db.commit()
        except Exception as exc:
            logger.warning("Failed to cache tile for farm %s: %s", farm.id, exc)
            db.rollback()

    def get_tile_history(
        self,
        farm_id: int,
        db: Session,
        limit: int = 12,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve the *limit* most-recent cached tile records for *farm_id*.
        Returns a list of dicts suitable for a frontend time slider.
        """
        rows = (
            db.query(NdviOverlay)
            .filter(
                NdviOverlay.farm_id == farm_id,
                NdviOverlay.tile_url_template.isnot(None),
            )
            .order_by(NdviOverlay.date.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "date": r.date.isoformat() if r.date else None,
                "tile_url": r.tile_url_template,
                "bounds": r.bounds,
                "mean_ndvi": r.mean_ndvi,
                "source": r.source,
            }
            for r in rows
        ]

    def get_ndvi_tile_info_cached(
        self,
        farm: Farm,
        db: Session,
        days_back: int = 30,
    ) -> Dict[str, Any]:
        """
        Wrapper around get_ndvi_tile_info that also caches the result
        into NdviOverlay for time-series history.
        """
        result = self.get_ndvi_tile_info(farm, db, days_back)
        if result.get("tile_url"):
            self.cache_tile_result(farm, result, db)
        return result
