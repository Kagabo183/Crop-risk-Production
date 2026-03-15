"""
Multi-Satellite Data Fusion Service
-------------------------------------
Fuses Sentinel-1 SAR, Sentinel-2 optical, and Landsat-8/9 imagery into a
single, cloud-resistant vegetation monitoring dataset.

Why this matters:
  • Sentinel-2 cannot see through clouds (optical).
  • Sentinel-1 SAR penetrates clouds and gives vegetation structure signals
    (VV, VH backscatter) even during rainy seasons.
  • Landsat provides long historical context for anomaly baselines.

Fusion pipeline (per farm):
  1. Fetch S2 median composite for window   →  NDVI, NDRE, NDWI, EVI, SAVI
  2. Fetch S1 GRD median composite          →  VV, VH backscatter dB
  3. When S2 is cloud-obscured (> threshold):
       - use S1 VH → synthetic NDVI estimate (empirical regression)
  4. Fill remaining gaps with Landsat-8/9   →  NDVI (30 m)
  5. Store fused observation in SatelliteImage table with source tag 'fusion'

Synthetic NDVI from SAR (simplified model):
  ndvi_est = 0.22 + 0.44 * (VH / VV)   (Nguyen et al. 2021 Rwanda calibration)
  Clamped to [-0.1, 0.9].

All remote sensing calls protected:  GEE not available → graceful fallback,
returns existing DB records only.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.core import gee_manager
from app.db.database import SessionLocal
from app.models.data import SatelliteImage, VegetationHealth
from app.models.farm import Farm

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

S1_VH_VV_OFFSET = 0.22     # empirical constant for NDVI_est = offset + scale * (VH/VV)
S1_VH_VV_SCALE  = 0.44
CLOUD_THRESHOLD = 30        # % above which S2 is considered unreliable
SAR_NDVI_RELIABILITY = 0.70  # SAR-derived NDVI is less reliable; stored confidence < 1

# Band dict order: [B2, B4, B8, B8A, B11] for common index calculations
S2_BANDS = ["B2", "B4", "B8", "B8A", "B11"]


class SatelliteFusionService:
    """
    Performs multi-source satellite data fusion for a single farm polygon.

    Usage::
        svc = SatelliteFusionService()
        obs = svc.run_fusion(farm, db, days_back=15)
        # obs is a list of dicts, one per fused observation
    """

    # ── Public API ─────────────────────────────────────────────────────────────

    def run_fusion(
        self,
        farm: Farm,
        db: Session,
        days_back: int = 15,
        cloud_threshold: int = CLOUD_THRESHOLD,
    ) -> List[Dict[str, Any]]:
        """
        Execute the full three-source fusion for *farm* over the last *days_back* days.

        Returns a list of fused observation dicts and persists them to
        the satellite_images table (source = 'fusion_*').
        """
        if not (farm.latitude and farm.longitude):
            logger.debug("Farm %s has no coordinates; skipping fusion", farm.id)
            return []

        if not gee_manager.is_initialized():
            logger.info("GEE not available; returning DB-only observations for farm %s", farm.id)
            return self._load_existing_observations(farm, db, days_back)

        results: List[Dict[str, Any]] = []

        try:
            import ee
            farm_geom = self._build_farm_geometry(farm)
            end_dt = datetime.utcnow()
            start_dt = end_dt - timedelta(days=days_back)
            start_str = start_dt.strftime("%Y-%m-%d")
            end_str = end_dt.strftime("%Y-%m-%d")

            # ── Step 1: Sentinel-2 optical ────────────────────────────────────
            s2_obs = self._fetch_sentinel2(farm, farm_geom, start_str, end_str, cloud_threshold)

            # ── Step 2: Sentinel-1 SAR ────────────────────────────────────────
            s1_obs = self._fetch_sentinel1(farm, farm_geom, start_str, end_str)

            # ── Step 3: Determine gaps ─────────────────────────────────────────
            s2_dates = {o["date"] for o in s2_obs}
            gap_candidates = [o for o in s2_obs if o.get("cloud_cover", 0) > cloud_threshold]
            covered_by_s1 = {o["date"] for o in s1_obs}

            # ── Step 4: Landsat for remaining large gaps ───────────────────────
            # Only call Landsat if there are dates with no S2 AND no S1
            all_covered = s2_dates | covered_by_s1
            landsat_obs: List[Dict] = []
            # We always supplement with Landsat as a baseline anchor
            try:
                landsat_obs = self._fetch_landsat(farm, farm_geom, start_str, end_str)
            except Exception as exc:
                logger.warning("Landsat fetch failed for farm %s: %s", farm.id, exc)

            # ── Step 5: Merge – prefer S2 > S1_derived > Landsat ──────────────
            fused = self._merge_observations(s2_obs, s1_obs, landsat_obs, cloud_threshold)

            # ── Step 6: Persist to DB ──────────────────────────────────────────
            self._upsert_observations(farm, fused, db)
            results = fused

        except Exception as exc:
            logger.error("Fusion pipeline failed for farm %s: %s", farm.id, exc, exc_info=True)

        return results

    def get_fusion_status(self, farm: Farm, db: Session, days_back: int = 30) -> Dict[str, Any]:
        """
        Return a summary of the fusion dataset quality for *farm*.
        Counts: optical observations, SAR-filled observations, Landsat-filled,
        cloud coverage %, data gap days.
        """
        since = datetime.utcnow() - timedelta(days=days_back)
        records = (
            db.query(SatelliteImage)
            .filter(
                SatelliteImage.farm_id == farm.id,
                SatelliteImage.date >= since.date(),
            )
            .order_by(SatelliteImage.date.asc())
            .all()
        )

        total = len(records)
        by_source: Dict[str, int] = {}
        for r in records:
            src = r.source or "unknown"
            by_source[src] = by_source.get(src, 0) + 1

        ndvi_values = [r.mean_ndvi for r in records if r.mean_ndvi is not None]
        mean_cloud = (
            sum(r.cloud_cover_percent for r in records if r.cloud_cover_percent is not None)
            / max(1, sum(1 for r in records if r.cloud_cover_percent is not None))
        )

        return {
            "farm_id": farm.id,
            "days_back": days_back,
            "total_observations": total,
            "by_source": by_source,
            "mean_cloud_cover_pct": round(mean_cloud, 1),
            "mean_ndvi": round(sum(ndvi_values) / len(ndvi_values), 4) if ndvi_values else None,
            "gap_days": max(0, days_back - total),
            "coverage_pct": round(min(100.0, total / days_back * 100), 1),
            "sar_filled": by_source.get("fusion_sar", 0),
            "landsat_filled": by_source.get("fusion_landsat", 0),
            "optical_observations": by_source.get("sentinel2", 0) + by_source.get("fusion_s2", 0),
        }

    # ── Private: GEE data fetching ─────────────────────────────────────────────

    def _fetch_sentinel2(
        self,
        farm: Farm,
        farm_geom,
        start_str: str,
        end_str: str,
        cloud_threshold: int,
    ) -> List[Dict[str, Any]]:
        """Fetch S2 vegetation indices for the window. Returns per-image records."""
        import ee

        col = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(farm_geom)
            .filterDate(start_str, end_str)
            .sort("system:time_start")
        )

        size = col.size().getInfo()
        if size == 0:
            return []

        images = col.toList(min(size, 20))  # cap at 20 to avoid quota issues
        results = []

        for i in range(images.length().getInfo()):
            try:
                img = ee.Image(images.get(i))
                cloud_pct = img.get("CLOUDY_PIXEL_PERCENTAGE").getInfo() or 0.0
                ts = img.get("system:time_start").getInfo()
                obs_date = datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")

                # Calculate indices
                ndvi  = img.normalizedDifference(["B8",  "B4"]).rename("NDVI")
                ndre  = img.normalizedDifference(["B8",  "B5"]).rename("NDRE")
                ndwi  = img.normalizedDifference(["B8",  "B11"]).rename("NDWI")
                evi   = img.expression(
                    "2.5 * (NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1)",
                    {"NIR": img.select("B8"), "RED": img.select("B4"), "BLUE": img.select("B2")},
                ).rename("EVI")
                savi  = img.expression(
                    "((NIR - RED) / (NIR + RED + 0.5)) * 1.5",
                    {"NIR": img.select("B8"), "RED": img.select("B4")},
                ).rename("SAVI")
                # MSAVI — Modified Soil-Adjusted Vegetation Index
                msavi = img.expression(
                    "(2 * NIR + 1 - sqrt(pow(2 * NIR + 1, 2) - 8 * (NIR - RED))) / 2",
                    {"NIR": img.select("B8"), "RED": img.select("B4")},
                ).rename("MSAVI")

                stack = ee.Image([ndvi, ndre, ndwi, evi, savi, msavi])
                stats = stack.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=farm_geom,
                    scale=20,
                    maxPixels=1_000_000,
                ).getInfo()

                results.append({
                    "date": obs_date,
                    "source": "sentinel2",
                    "cloud_cover": float(cloud_pct),
                    "ndvi":  float(stats.get("NDVI") or 0.0),
                    "ndre":  float(stats.get("NDRE") or 0.0),
                    "ndwi":  float(stats.get("NDWI") or 0.0),
                    "evi":   float(stats.get("EVI") or 0.0),
                    "savi":  float(stats.get("SAVI") or 0.0),
                    "msavi": float(stats.get("MSAVI") or 0.0),
                    "reliable": float(cloud_pct) <= cloud_threshold,
                })
            except Exception as exc:
                logger.debug("S2 image %d failed for farm %s: %s", i, farm.id, exc)

        return results

    def _fetch_sentinel1(
        self,
        farm: Farm,
        farm_geom,
        start_str: str,
        end_str: str,
    ) -> List[Dict[str, Any]]:
        """
        Fetch Sentinel-1 GRD (Ground Range Detected) backscatter.

        Uses IW (Interferometric Wide), dual-pol VV+VH.
        Converts linear scale to dB.  Synthesises pseudo-NDVI from VH/VV ratio.
        """
        import ee

        col = (
            ee.ImageCollection("COPERNICUS/S1_GRD")
            .filterBounds(farm_geom)
            .filterDate(start_str, end_str)
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
            .filter(ee.Filter.eq("instrumentMode", "IW"))
            .sort("system:time_start")
        )

        size = col.size().getInfo()
        if size == 0:
            return []

        images = col.toList(min(size, 20))
        results = []

        for i in range(images.length().getInfo()):
            try:
                img = ee.Image(images.get(i))
                ts   = img.get("system:time_start").getInfo()
                obs_date = datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")

                # Backscatter in dB
                vv = img.select("VV")
                vh = img.select("VH")

                stats = (
                    ee.Image([vv.rename("VV"), vh.rename("VH")])
                    .reduceRegion(
                        reducer=ee.Reducer.mean(),
                        geometry=farm_geom,
                        scale=20,
                        maxPixels=1_000_000,
                    )
                    .getInfo()
                )

                vv_val = float(stats.get("VV") or -15.0)
                vh_val = float(stats.get("VH") or -20.0)

                # Convert dB to linear for ratio
                vv_lin = 10 ** (vv_val / 10)
                vh_lin = 10 ** (vh_val / 10)
                ratio  = vh_lin / max(vv_lin, 1e-6)

                # Synthetic NDVI estimate
                ndvi_est = float(
                    max(-0.1, min(0.9, S1_VH_VV_OFFSET + S1_VH_VV_SCALE * ratio))
                )

                results.append({
                    "date": obs_date,
                    "source": "sentinel1_sar",
                    "cloud_cover": 0.0,  # SAR is all-weather
                    "vv_db": round(vv_val, 3),
                    "vh_db": round(vh_val, 3),
                    "ndvi":  round(ndvi_est, 4),  # synthetic estimate
                    "ndre":  None,                  # not available from SAR
                    "ndwi":  None,
                    "evi":   None,
                    "savi":  None,
                    "msavi": None,
                    "reliable": True,   # SAR always reliable for NDVI proxy
                    "is_sar_derived": True,
                })
            except Exception as exc:
                logger.debug("S1 image %d failed for farm %s: %s", i, farm.id, exc)

        return results

    def _fetch_landsat(
        self,
        farm: Farm,
        farm_geom,
        start_str: str,
        end_str: str,
    ) -> List[Dict[str, Any]]:
        """Fetch Landsat-8/9 NDVI for historical gap filling."""
        import ee

        # Try LC09 first, fall back to LC08
        for collection_id, sr_red, sr_nir in [
            ("LANDSAT/LC09/C02/T1_L2", "SR_B4", "SR_B5"),
            ("LANDSAT/LC08/C02/T1_L2", "SR_B4", "SR_B5"),
        ]:
            try:
                col = (
                    ee.ImageCollection(collection_id)
                    .filterBounds(farm_geom)
                    .filterDate(start_str, end_str)
                    .sort("system:time_start")
                )
                size = col.size().getInfo()
                if size == 0:
                    continue

                images = col.toList(min(size, 10))
                results = []

                for i in range(images.length().getInfo()):
                    img = ee.Image(images.get(i))
                    ts  = img.get("system:time_start").getInfo()
                    obs_date = datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")

                    ndvi_img = img.normalizedDifference([sr_nir, sr_red]).rename("NDVI")
                    stats = ndvi_img.reduceRegion(
                        reducer=ee.Reducer.mean(),
                        geometry=farm_geom,
                        scale=30,
                        maxPixels=500_000,
                    ).getInfo()

                    results.append({
                        "date": obs_date,
                        "source": "landsat",
                        "cloud_cover": 0.0,
                        "ndvi":  float(stats.get("NDVI") or 0.0),
                        "ndre":  None,
                        "ndwi":  None,
                        "evi":   None,
                        "savi":  None,
                        "msavi": None,
                        "reliable": True,
                    })

                return results
            except Exception:
                continue

        return []

    # ── Private: Fusion merge logic ─────────────────────────────────────────────

    def _merge_observations(
        self,
        s2_obs: List[Dict],
        s1_obs: List[Dict],
        landsat_obs: List[Dict],
        cloud_threshold: int,
    ) -> List[Dict[str, Any]]:
        """
        For each unique observation date, select the best available source:
          Priority: reliable S2 > S1-SAR derived > Landsat > cloudy S2
        """
        by_date: Dict[str, Dict] = {}

        # Seed with Landsat first (lowest priority)
        for o in landsat_obs:
            by_date[o["date"]] = {**o, "fusion_source": "landsat"}

        # Overwrite with SAR-derived where available
        for o in s1_obs:
            d = o["date"]
            if d not in by_date or by_date[d]["fusion_source"] == "landsat":
                by_date[d] = {**o, "fusion_source": "fusion_sar"}

        # Overwrite with reliable S2 (cloud ≤ threshold)
        for o in s2_obs:
            d = o["date"]
            if o.get("reliable", False):
                by_date[d] = {**o, "fusion_source": "sentinel2"}
            elif d not in by_date:
                # Cloud-affected S2 still better than nothing
                by_date[d] = {**o, "fusion_source": "fusion_cloudy_s2"}

        return list(by_date.values())

    # ── Private: DB persistence ────────────────────────────────────────────────

    def _upsert_observations(
        self,
        farm: Farm,
        observations: List[Dict[str, Any]],
        db: Session,
    ) -> None:
        """
        Insert or update SatelliteImage rows for fused observations.
        Updates existing row if one exists for the same farm+date.
        """
        from datetime import date as date_type
        import re

        for obs in observations:
            obs_date_str = obs.get("date")
            if not obs_date_str:
                continue

            try:
                # parse date
                obs_date = datetime.strptime(obs_date_str, "%Y-%m-%d").date()
                source = obs.get("fusion_source") or obs.get("source", "fusion")

                existing = (
                    db.query(SatelliteImage)
                    .filter(
                        SatelliteImage.farm_id == farm.id,
                        SatelliteImage.date == obs_date,
                    )
                    .first()
                )

                ndvi  = obs.get("ndvi")
                cloud = obs.get("cloud_cover")

                if existing:
                    # Only overwrite if new source is more reliable
                    if obs.get("reliable", True) or existing.source in ("fusion_cloudy_s2",):
                        existing.source = source
                        existing.mean_ndvi = ndvi if ndvi is not None else existing.mean_ndvi
                        existing.mean_ndre = obs.get("ndre") or existing.mean_ndre
                        existing.mean_ndwi = obs.get("ndwi") or existing.mean_ndwi
                        existing.mean_evi  = obs.get("evi")  or existing.mean_evi
                        existing.mean_savi = obs.get("savi") or existing.mean_savi
                        existing.cloud_cover_percent = cloud if cloud is not None else existing.cloud_cover_percent
                        existing.processing_status = "completed"
                else:
                    new_img = SatelliteImage(
                        farm_id=farm.id,
                        date=obs_date,
                        acquisition_date=obs_date,
                        source=source,
                        cloud_cover_percent=cloud,
                        mean_ndvi=ndvi,
                        mean_ndre=obs.get("ndre"),
                        mean_ndwi=obs.get("ndwi"),
                        mean_evi=obs.get("evi"),
                        mean_savi=obs.get("savi"),
                        processing_status="completed",
                        extra_metadata={
                            "is_sar_derived": obs.get("is_sar_derived", False),
                            "vv_db": obs.get("vv_db"),
                            "vh_db": obs.get("vh_db"),
                            "msavi": obs.get("msavi"),
                        },
                    )
                    db.add(new_img)

            except Exception as exc:
                logger.warning("Failed to upsert observation %s: %s", obs, exc)

        try:
            db.commit()
        except Exception as exc:
            logger.error("DB commit failed in fusion upsert: %s", exc)
            db.rollback()

    def _load_existing_observations(
        self, farm: Farm, db: Session, days_back: int
    ) -> List[Dict[str, Any]]:
        """Fallback: Load existing SatelliteImage records from DB."""
        since = (datetime.utcnow() - timedelta(days=days_back)).date()
        records = (
            db.query(SatelliteImage)
            .filter(
                SatelliteImage.farm_id == farm.id,
                SatelliteImage.date >= since,
            )
            .order_by(SatelliteImage.date.asc())
            .all()
        )
        return [
            {
                "date": r.date.isoformat() if r.date else None,
                "source": r.source,
                "ndvi": r.mean_ndvi,
                "ndre": r.mean_ndre,
                "ndwi": r.mean_ndwi,
                "evi":  r.mean_evi,
                "savi": r.mean_savi,
                "cloud_cover": r.cloud_cover_percent,
                "fusion_source": r.source,
            }
            for r in records
        ]

    # ── Private: Geometry helper ───────────────────────────────────────────────

    def _build_farm_geometry(self, farm: Farm):
        """Build GEE geometry from farm boundary or centroid buffer."""
        import ee

        if farm.boundary is not None:
            try:
                from geoalchemy2.shape import to_shape
                shp = to_shape(farm.boundary)
                coords = [list(shp.exterior.coords)]
                return ee.Geometry.Polygon([[[c[0], c[1]] for c in coords[0]]])
            except Exception:
                pass

        lat = farm.latitude or -1.95
        lon = farm.longitude or 29.87
        return ee.Geometry.Point([lon, lat]).buffer(500)
