"""
Productivity Zone Service
--------------------------
Divides a farm polygon into high / medium / low productivity zones
using K-means clustering on NDVI pixel data.

Primary backend:  Google Earth Engine (K-means on real Sentinel-2 NDVI pixels)
Fallback:         Statistical simulation on a 10×10 grid using VegetationHealth
                  history from the database (no GEE dependency).

Zone classification:
  high   – NDVI above 66th percentile of farm pixels
  medium – NDVI between 33rd and 66th percentile
  low    – NDVI below 33rd percentile
"""
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from app.models.farm import Farm
from app.models.data import VegetationHealth
from app.models.geo_intelligence import ProductivityZone
from app.core import gee_manager

logger = logging.getLogger(__name__)

ZONE_COLORS: Dict[str, str] = {
    "high": "#4CAF50",    # green
    "medium": "#FFC107",  # amber
    "low": "#F44336",     # red
}


class ProductivityZoneService:
    """Compute and persist K-means productivity zones for a farm."""

    def compute_and_save(
        self,
        farm: Farm,
        db: Session,
        n_zones: int = 3,
        days_back: int = 90,
    ) -> List[Dict[str, Any]]:
        """
        Compute productivity zones and persist to the database.

        Previous zones for this farm are replaced.

        Returns list of zone dicts (without WKB boundary – use boundary field in DB).
        """
        # Delete existing zones for this farm
        db.query(ProductivityZone).filter(ProductivityZone.farm_id == farm.id).delete()
        db.flush()

        zones: List[Dict] = []

        if gee_manager.is_initialized():
            try:
                zones = self._compute_gee_zones(farm, n_zones, days_back)
            except Exception as exc:
                logger.warning(
                    "GEE K-means zone computation failed for farm %s: %s", farm.id, exc
                )

        if not zones:
            zones = self._compute_statistical_zones(farm, db, n_zones)

        self._persist_zones(farm.id, zones, db)
        return zones

    # ── GEE K-means path ─────────────────────────────────────────────────────────

    def _compute_gee_zones(self, farm: Farm, n_zones: int, days_back: int) -> List[Dict]:
        import ee

        end = datetime.utcnow()
        start = end - timedelta(days=days_back)

        # Build farm geometry
        farm_geom = self._farm_geom_gee(farm)

        # Sentinel-2 NDVI median composite
        collection = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(farm_geom)
            .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
        )

        if collection.size().getInfo() == 0:
            logger.info("GEE zones: no S2 imagery for farm %s", farm.id)
            return []

        ndvi = collection.median().normalizedDifference(["B8", "B4"]).rename("NDVI")

        # Sample pixels for training
        n_pixels = max(100, min(500, int((farm.area or 0.5) * 200)))
        training_data = ndvi.sample(region=farm_geom, scale=20, numPixels=n_pixels)

        # K-means clustering
        clusterer = ee.Clusterer.wekaKMeans(n_zones).train(training_data)
        clustered = ndvi.cluster(clusterer)

        # Compute mean NDVI per cluster
        cluster_ndvi: List[tuple] = []
        for cid in range(n_zones):
            mask = clustered.eq(cid)
            stats = ndvi.updateMask(mask).reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=farm_geom,
                scale=30,
                maxPixels=1_000_000,
            ).getInfo()
            cluster_ndvi.append((cid, float(stats.get("NDVI") or 0.0)))

        # High = highest NDVI cluster
        cluster_ndvi.sort(key=lambda x: x[1], reverse=True)
        zone_labels = ["high", "medium", "low"][:n_zones]
        label_map = {cid: zone_labels[i] for i, (cid, _) in enumerate(cluster_ndvi)}

        zones: List[Dict] = []
        for cid, mean_ndvi in cluster_ndvi:
            # Extract cluster polygon(s)
            zone_mask = clustered.eq(cid)
            vectors = zone_mask.reduceToVectors(
                geometry=farm_geom,
                scale=30,
                geometryType="polygon",
                maxPixels=1_000_000,
            )
            boundary_geojson = self._fc_to_merged_geojson(vectors.getInfo())

            zone_class = label_map[cid]
            zones.append({
                "zone_class": zone_class,
                "mean_ndvi": round(mean_ndvi, 4),
                "zone_index": cid,
                "color_hex": ZONE_COLORS[zone_class],
                "boundary": boundary_geojson,
                "source": "gee",
            })

        return zones

    # ── Statistical fallback path ────────────────────────────────────────────────

    def _compute_statistical_zones(
        self, farm: Farm, db: Session, n_zones: int
    ) -> List[Dict]:
        """
        Simulate pixel-level NDVI variation from farm-level history.

        Applies a spatial gradient (centre > edges) + Gaussian noise over
        a 12×12 grid, then K-means clusters the cells.
        """
        import numpy as np

        # Pull NDVI history
        records = (
            db.query(VegetationHealth)
            .filter(VegetationHealth.farm_id == farm.id)
            .order_by(VegetationHealth.date.desc())
            .limit(30)
            .all()
        )
        ndvi_vals = [r.ndvi for r in records if r.ndvi is not None]
        base_ndvi = float(np.mean(ndvi_vals)) if ndvi_vals else 0.35
        ndvi_std = float(np.std(ndvi_vals)) if len(ndvi_vals) > 2 else 0.07

        # 12×12 spatial grid with radial gradient
        n = 12
        rng = np.random.default_rng(seed=int(farm.id) * 7)
        cx = cy = n / 2.0
        grid = np.zeros((n, n))
        for i in range(n):
            for j in range(n):
                dist_factor = 1.0 - 0.25 * ((i - cx) ** 2 + (j - cy) ** 2) / (n ** 2)
                grid[i, j] = base_ndvi * dist_factor + rng.normal(0, ndvi_std)
        grid = np.clip(grid, 0.0, 1.0)

        # K-means on flattened 1D NDVI values
        flat = grid.flatten().reshape(-1, 1)
        try:
            from sklearn.cluster import KMeans
            km = KMeans(n_clusters=n_zones, random_state=42, n_init="auto")
            labels = km.fit_predict(flat)
        except ImportError:
            # Percentile-based fallback when sklearn is absent
            thresholds = np.percentile(flat, [100 / n_zones * i for i in range(1, n_zones)])
            labels = np.digitize(flat.flatten(), thresholds)

        # Compute cluster means
        cluster_ndvi: Dict[int, float] = {}
        for clid in range(n_zones):
            vals = flat[labels == clid].flatten()
            cluster_ndvi[clid] = float(np.mean(vals)) if len(vals) > 0 else 0.0

        sorted_clusters = sorted(cluster_ndvi.items(), key=lambda x: x[1], reverse=True)
        zone_labels = ["high", "medium", "low"][:n_zones]
        label_map = {clid: zone_labels[i] for i, (clid, _) in enumerate(sorted_clusters)}

        # Build GeoJSON polygons from grid cells
        lat = farm.latitude or -1.95
        lon = farm.longitude or 29.87
        area_deg = ((farm.area or 0.5) ** 0.5) / 111.0
        lat_min = lat - area_deg / 2
        lon_min = lon - area_deg / 2
        cell_lat = area_deg / n
        cell_lon = area_deg / n

        cluster_cells: Dict[int, list] = {c: [] for c in range(n_zones)}
        for idx, label in enumerate(labels):
            i, j = divmod(idx, n)
            cluster_cells[int(label)].append((i, j))

        zones: List[Dict] = []
        for clid, mean_val in sorted_clusters:
            cells = cluster_cells[clid]
            cell_polys = []
            for i, j in cells:
                s = lat_min + i * cell_lat
                n_ = s + cell_lat
                w = lon_min + j * cell_lon
                e = w + cell_lon
                cell_polys.append(
                    {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n_], [w, n_], [w, s]]]}
                )

            boundary_geojson = self._merge_cell_polys(cell_polys)

            zone_class = label_map[clid]
            zones.append({
                "zone_class": zone_class,
                "mean_ndvi": round(float(mean_val), 4),
                "zone_index": clid,
                "color_hex": ZONE_COLORS[zone_class],
                "boundary": boundary_geojson,
                "source": "statistical",
            })

        return zones

    # ── Persistence ──────────────────────────────────────────────────────────────

    def _persist_zones(self, farm_id: int, zones: List[Dict], db: Session) -> None:
        for zone in zones:
            boundary_wkb = None
            area_ha = None
            if zone.get("boundary"):
                try:
                    from geoalchemy2.shape import from_shape
                    from shapely.geometry import shape as shapely_shape
                    s = shapely_shape(zone["boundary"])
                    if not s.is_empty:
                        boundary_wkb = from_shape(s, srid=4326)
                        # Compute area using pyproj geodesic calculation
                        try:
                            from pyproj import Geod
                            geod = Geod(ellps="WGS84")
                            abs_area, _ = geod.geometry_area_perimeter(s)
                            area_ha = abs(abs_area) / 10000.0
                        except Exception:
                            pass
                except Exception as exc:
                    logger.debug("Could not encode zone boundary: %s", exc)

            db.add(
                ProductivityZone(
                    farm_id=farm_id,
                    zone_class=zone["zone_class"],
                    boundary=boundary_wkb,
                    mean_ndvi=zone["mean_ndvi"],
                    zone_index=zone["zone_index"],
                    color_hex=zone["color_hex"],
                    area_ha=round(area_ha, 3) if area_ha else None,
                    computed_at=datetime.utcnow(),
                )
            )
        db.commit()

    # ── Geometry helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _farm_geom_gee(farm: Farm):
        import ee
        if farm.boundary is not None:
            try:
                from geoalchemy2.shape import to_shape
                s = to_shape(farm.boundary)
                coords = list(s.exterior.coords)
                return ee.Geometry.Polygon([[[c[0], c[1]] for c in coords]])
            except Exception:
                pass
        return ee.Geometry.Point([farm.longitude, farm.latitude]).buffer(300)

    @staticmethod
    def _fc_to_merged_geojson(fc: Dict) -> Any:
        """Merge GEE FeatureCollection polygons into a single GeoJSON geometry."""
        features = (fc or {}).get("features", [])
        if not features:
            return None
        try:
            import shapely.geometry
            import shapely.ops
            polys = [
                shapely.geometry.shape(f["geometry"])
                for f in features
                if f.get("geometry")
            ]
            merged = shapely.ops.unary_union(polys)
            return json.loads(json.dumps(shapely.geometry.mapping(merged)))
        except Exception:
            # Return first feature geometry as fallback
            return features[0].get("geometry") if features else None

    @staticmethod
    def _merge_cell_polys(polys: list) -> Any:
        """Merge list of GeoJSON cell polygons into a single geometry."""
        try:
            import shapely.geometry
            import shapely.ops
            shapes = [shapely.geometry.shape(p) for p in polys]
            merged = shapely.ops.unary_union(shapes)
            return json.loads(json.dumps(shapely.geometry.mapping(merged)))
        except Exception:
            return {"type": "MultiPolygon", "coordinates": [p["coordinates"] for p in polys]}
