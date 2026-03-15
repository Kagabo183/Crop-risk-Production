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
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.farm import Farm
from app.models.data import VegetationHealth
from app.core import gee_manager

logger = logging.getLogger(__name__)

# GEE colour palette (hex strings, no '#')
NDVI_PALETTE = ["F44336", "FF5722", "FFC107", "CDDC39", "8BC34A", "4CAF50"]
NDVI_VIS = {"min": 0.0, "max": 0.75, "palette": NDVI_PALETTE}


class NdviTileService:
    """Generate NDVI tile overlay info for Leaflet map rendering."""

    def get_ndvi_tile_info(
        self,
        farm: Farm,
        db: Session,
        days_back: int = 30,
    ) -> Dict[str, Any]:
        """
        Return NDVI overlay information for a farm.

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

        if gee_manager.is_initialized():
            try:
                return self._get_gee_tiles(farm, days_back)
            except Exception as exc:
                logger.warning(
                    "GEE tile generation failed for farm %s: %s", farm.id, exc
                )

        return self._get_fallback_info(farm, db)

    # ── GEE path ────────────────────────────────────────────────────────────────

    def _get_gee_tiles(self, farm: Farm, days_back: int) -> Dict[str, Any]:
        import ee  # Import guarded – only available when GEE is initialised

        end = datetime.utcnow()
        start = end - timedelta(days=days_back)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        farm_geom, bounds_sw, bounds_ne = self._build_geom(farm)

        # Sentinel-2 NDVI median composite
        s2 = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(farm_geom)
            .filterDate(start_str, end_str)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
        )

        count = s2.size().getInfo()

        if count > 0:
            ndvi_image = (
                s2.median()
                .normalizedDifference(["B8", "B4"])
                .rename("NDVI")
            )
            source = "gee_sentinel2"
        else:
            # Landsat-9 fallback
            lc9 = (
                ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
                .filterBounds(farm_geom)
                .filterDate(start_str, end_str)
                .map(lambda img: img.normalizedDifference(["SR_B5", "SR_B4"]).rename("NDVI"))
            )
            ndvi_image = lc9.median().rename("NDVI")
            source = "gee_landsat9"

        # Mean NDVI statistic
        mean_dict = ndvi_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=farm_geom,
            scale=30,
            maxPixels=1_000_000,
        ).getInfo()
        mean_ndvi = float(mean_dict.get("NDVI") or 0.3)

        # Signed tile URL
        map_id = ndvi_image.getMapId(NDVI_VIS)
        tile_url = map_id["tile_fetcher"].url_format

        return {
            "tile_url": tile_url,
            "bounds": [bounds_sw, bounds_ne],
            "mean_ndvi": round(mean_ndvi, 4),
            "source": source,
            "date": end_str,
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
