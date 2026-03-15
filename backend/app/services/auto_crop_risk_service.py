"""
Auto Crop Risk Service — Complete pipeline for automatic satellite-based crop risk assessment.

Flow:
  1. Fetch Sentinel-2 satellite data via Google Earth Engine (farm polygon, last 10-15 days, <20% cloud)
  2. Calculate vegetation indices (NDVI, NDRE, NDWI, EVI, SAVI)
  3. Extract values from farm boundary (median/mean pixel values)
  4. Compute composite health score (weighted 0-100)
  5. Classify farm health (Healthy / Moderate Stress / High Stress)
  6. Run disease risk models (Late Blight, Septoria, Powdery Mildew, Fusarium Wilt)
  7. Return structured auto crop risk output with recommendations

Caching: Results are cached for 24 hours per farm to minimise GEE calls.
Determinism: Identical coordinates always return identical index values.
"""

import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.data import SatelliteImage, VegetationHealth, WeatherRecord
from app.models.farm import Farm
from app.db.database import SessionLocal

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (keyed by farm coords + date bucket).  Replaced by Redis
# when available.
# ---------------------------------------------------------------------------
_risk_cache: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 86400  # 24 hours


def _cache_key(farm_id: int, lat: float, lon: float) -> str:
    """Deterministic cache key — identical coordinates share the same key."""
    coord_str = f"{round(lat, 6)}:{round(lon, 6)}"
    date_bucket = datetime.utcnow().strftime("%Y-%m-%d")
    return hashlib.sha256(f"{coord_str}:{date_bucket}".encode()).hexdigest()


def _get_cached(key: str) -> Optional[Dict]:
    entry = _risk_cache.get(key)
    if entry and (time.time() - entry["ts"]) < _CACHE_TTL_SECONDS:
        logger.info(f"Cache HIT for key {key[:12]}…")
        return entry["data"]
    return None


def _set_cache(key: str, data: Dict):
    _risk_cache[key] = {"ts": time.time(), "data": data}
    # Try Redis if available
    try:
        import redis
        from app.core.config import settings
        r = redis.Redis(
            host=getattr(settings, "REDIS_HOST", "localhost"),
            port=int(getattr(settings, "REDIS_PORT", 6379)),
            db=0,
            socket_connect_timeout=2,
        )
        r.setex(f"crop_risk:{key}", _CACHE_TTL_SECONDS, json.dumps(data, default=str))
    except Exception:
        pass  # In-memory fallback is fine


def _get_redis_cached(key: str) -> Optional[Dict]:
    try:
        import redis
        from app.core.config import settings
        r = redis.Redis(
            host=getattr(settings, "REDIS_HOST", "localhost"),
            port=int(getattr(settings, "REDIS_PORT", 6379)),
            db=0,
            socket_connect_timeout=2,
        )
        raw = r.get(f"crop_risk:{key}")
        if raw:
            logger.info(f"Redis cache HIT for key {key[:12]}…")
            return json.loads(raw)
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Vegetation index weights for composite health score
# ---------------------------------------------------------------------------
INDEX_WEIGHTS = {
    "ndvi": 0.30,
    "ndre": 0.20,
    "ndwi": 0.20,
    "evi":  0.15,
    "savi": 0.15,
}


def _normalize_index(name: str, value: float) -> float:
    """
    Normalise a raw vegetation index value to a 0-100 scale.

    Typical healthy ranges (Sentinel-2):
        NDVI  : -1 … +1   (healthy >0.6)
        NDRE  : -1 … +1   (healthy >0.3)
        NDWI  : -1 … +1   (healthy > -0.1, water-rich >0.1)
        EVI   : -0.2 … 1  (healthy >0.4)
        SAVI  : -0.2 … 1  (healthy >0.4)

    We map each to 0-100 using piecewise linear scaling.
    """
    ranges = {
        "ndvi": (-0.2, 0.9),
        "ndre": (-0.2, 0.7),
        "ndwi": (-0.5, 0.5),
        "evi":  (-0.2, 0.8),
        "savi": (-0.2, 0.8),
    }
    lo, hi = ranges.get(name, (-1, 1))
    clamped = max(lo, min(hi, value))
    return round(((clamped - lo) / (hi - lo)) * 100, 2)


def compute_composite_health_score(indices: Dict[str, Optional[float]]) -> float:
    """
    Composite Score = NDVI*0.30 + NDRE*0.20 + NDWI*0.20 + EVI*0.15 + SAVI*0.15
    Normalised to 0-100.
    """
    score = 0.0
    total_weight = 0.0
    for name, weight in INDEX_WEIGHTS.items():
        val = indices.get(name)
        if val is not None:
            score += _normalize_index(name, val) * weight
            total_weight += weight
    if total_weight == 0:
        return 0.0
    return round(score / total_weight * 1.0, 2)  # already weighted


def classify_health(score: float) -> str:
    """Healthy ≥ 70, Moderate Stress 50-69, High Stress < 50."""
    if score >= 70:
        return "Healthy"
    elif score >= 50:
        return "Moderate Stress"
    else:
        return "High Stress"


# ---------------------------------------------------------------------------
# Risk detection from indices + weather
# ---------------------------------------------------------------------------

def detect_risks(
    indices: Dict[str, Optional[float]],
    weather: Optional[Dict] = None,
    disease_results: Optional[List[Dict]] = None,
) -> List[str]:
    """Return list of detected risk tags."""
    risks: List[str] = []

    ndvi = indices.get("ndvi")
    ndwi = indices.get("ndwi")
    ndre = indices.get("ndre")
    evi = indices.get("evi")

    # Drought — low NDVI + low NDWI
    if ndvi is not None and ndvi < 0.35 and (ndwi is None or ndwi < 0.0):
        risks.append("drought")
    # Water stress — low NDWI
    if ndwi is not None and ndwi < -0.1:
        risks.append("water_stress")
    # Nutrient deficiency — low NDRE
    if ndre is not None and ndre < 0.2:
        risks.append("nutrient_deficiency")
    # Disease — flagged by any model with risk_score ≥ 50
    if disease_results:
        for d in disease_results:
            if d.get("risk_score", 0) >= 50:
                risks.append("disease")
                break

    return list(set(risks))


def generate_recommendations(
    health_status: str,
    risks: List[str],
    disease_results: Optional[List[Dict]] = None,
) -> List[str]:
    """Generate actionable recommendations based on risk profile."""
    recs: List[str] = []

    if health_status == "High Stress":
        recs.append("Immediate field inspection recommended — crop is under significant stress.")
    elif health_status == "Moderate Stress":
        recs.append("Schedule field visit within 3 days to assess crop condition.")

    if "drought" in risks:
        recs.append("Consider supplemental irrigation — soil moisture appears critically low.")
    if "water_stress" in risks and "drought" not in risks:
        recs.append("Monitor soil moisture levels and adjust irrigation schedule.")
    if "nutrient_deficiency" in risks:
        recs.append("Conduct soil testing and consider foliar fertiliser application.")
    if "disease" in risks and disease_results:
        high_risk = [d for d in disease_results if d.get("risk_score", 0) >= 50]
        for d in high_risk[:2]:
            actions = d.get("recommended_actions", [])
            if actions:
                recs.append(f"{d['disease_name']}: {actions[0]}")
            else:
                recs.append(f"Treat for {d['disease_name']} — risk score {d['risk_score']:.0f}/100.")

    if not recs:
        recs.append("Crop health is good. Continue routine monitoring.")

    return recs


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

class AutoCropRiskService:
    """
    Orchestrates the full auto crop risk pipeline:
      satellite fetch → index calculation → composite score → disease models → output
    """

    def __init__(self):
        self._satellite_service = None
        self._disease_engine = None
        self._stress_service = None

    @property
    def satellite_service(self):
        if self._satellite_service is None:
            from app.services.satellite_service import SatelliteDataService
            self._satellite_service = SatelliteDataService()
        return self._satellite_service

    @property
    def disease_engine(self):
        if self._disease_engine is None:
            from app.services.disease_intelligence import DiseaseModelEngine
            self._disease_engine = DiseaseModelEngine()
        return self._disease_engine

    @property
    def stress_service(self):
        if self._stress_service is None:
            from app.services.stress_detection_service import StressDetectionService
            self._stress_service = StressDetectionService()
        return self._stress_service

    # ---------- public API ----------

    def analyze_farm_risk(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 15,
        max_cloud_cover: float = 20.0,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Full auto crop risk analysis for a single farm.

        Returns the canonical output:
        {
            farm_id, crop_type, composite_health_score, health_status,
            vegetation_indices, detected_risk, disease_risk, recommended_action,
            data_source, analysis_timestamp
        }
        """
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            raise ValueError(f"Farm {farm_id} not found")
        if not farm.latitude or not farm.longitude:
            raise ValueError(f"Farm {farm_id} has no coordinates")

        # --- cache check ---
        cache_k = _cache_key(farm_id, farm.latitude, farm.longitude)
        if not force_refresh:
            cached = _get_redis_cached(cache_k) or _get_cached(cache_k)
            if cached:
                return cached

        logger.info(f"▶ Starting auto crop risk analysis for farm {farm_id} "
                     f"({farm.latitude}, {farm.longitude})")

        # ------------------------------------------------------------------
        # Step 1-3: Fetch satellite data & calculate indices
        # ------------------------------------------------------------------
        indices = self._fetch_and_calculate_indices(db, farm, days_back, max_cloud_cover)

        # ------------------------------------------------------------------
        # Step 4: Composite health score (0-100)
        # ------------------------------------------------------------------
        composite_score = compute_composite_health_score(indices)

        # ------------------------------------------------------------------
        # Step 5: Classify health
        # ------------------------------------------------------------------
        health_status = classify_health(composite_score)

        # ------------------------------------------------------------------
        # Step 6: Run disease risk models
        # ------------------------------------------------------------------
        weather_data = self._get_latest_weather(db, farm_id, farm.latitude, farm.longitude)
        disease_results = self._run_disease_models(weather_data, farm.crop_type)

        # ------------------------------------------------------------------
        # Step 7: Detect risks & recommendations
        # ------------------------------------------------------------------
        detected_risks = detect_risks(indices, weather_data, disease_results)
        recommendations = generate_recommendations(health_status, detected_risks, disease_results)

        # ------------------------------------------------------------------
        # Persist vegetation health record
        # ------------------------------------------------------------------
        self._persist_health_record(db, farm, indices, composite_score, health_status)

        # ------------------------------------------------------------------
        # Build output
        # ------------------------------------------------------------------
        result = {
            "farm_id": farm.id,
            "crop_type": farm.crop_type,
            "composite_health_score": composite_score,
            "health_status": health_status,
            "vegetation_indices": {
                "NDVI": indices.get("ndvi"),
                "NDRE": indices.get("ndre"),
                "NDWI": indices.get("ndwi"),
                "EVI": indices.get("evi"),
                "SAVI": indices.get("savi"),
            },
            "detected_risk": detected_risks,
            "disease_risk": [
                {
                    "disease": d["disease_name"],
                    "risk_score": d.get("risk_score", 0),
                    "risk_level": d.get("risk_level", "unknown"),
                    "recommended_actions": d.get("recommended_actions", []),
                }
                for d in disease_results
            ],
            "recommended_action": recommendations,
            "data_source": "google_earth_engine",
            "analysis_timestamp": datetime.utcnow().isoformat(),
        }

        # --- cache set ---
        _set_cache(cache_k, result)

        logger.info(f"✓ Farm {farm_id} risk analysis complete — "
                     f"score={composite_score}, status={health_status}, "
                     f"risks={detected_risks}")
        return result

    def analyze_all_farms(self, db: Session) -> Dict[str, Any]:
        """Run risk analysis on every farm with coordinates. Returns summary."""
        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None), Farm.longitude.isnot(None)
        ).all()

        summary = {"total": len(farms), "success": 0, "failed": 0, "results": []}
        for farm in farms:
            try:
                result = self.analyze_farm_risk(db, farm.id)
                summary["success"] += 1
                summary["results"].append({
                    "farm_id": farm.id,
                    "health_status": result["health_status"],
                    "composite_health_score": result["composite_health_score"],
                })
            except Exception as exc:
                summary["failed"] += 1
                logger.error(f"Farm {farm.id} risk analysis failed: {exc}")
        return summary

    # ---------- internal helpers ----------

    def _fetch_and_calculate_indices(
        self,
        db: Session,
        farm: Farm,
        days_back: int,
        max_cloud_cover: float,
    ) -> Dict[str, Optional[float]]:
        """
        Fetch satellite imagery and compute mean vegetation indices.
        Falls back to the most recent DB record if no new imagery is found.
        """
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days_back)

        try:
            imagery = self.satellite_service.fetch_sentinel2_imagery(
                lat=farm.latitude,
                lon=farm.longitude,
                start_date=start_date,
                end_date=end_date,
                max_cloud_cover=max_cloud_cover,
            )
        except Exception as exc:
            logger.warning(f"Satellite fetch failed for farm {farm.id}: {exc}")
            imagery = []

        if imagery:
            # Use the most recent image
            img = imagery[0]
            indices = self.satellite_service.calculate_vegetation_indices(
                image_data=img,
                lat=farm.latitude,
                lon=farm.longitude,
                buffer_meters=50,
                farm_boundary=farm.boundary,
                farm_area=farm.area,
            )

            # Persist satellite image record
            try:
                sat_image = SatelliteImage(
                    farm_id=farm.id,
                    date=img["date"].date() if hasattr(img["date"], "date") else img["date"],
                    acquisition_date=img["date"],
                    region=farm.location or "Unknown",
                    image_type="multispectral",
                    file_path=img.get("id", ""),
                    source=img.get("source", "sentinel2"),
                    cloud_cover_percent=img.get("cloud_cover", 0),
                    processing_status="completed",
                    mean_ndvi=indices.get("ndvi"),
                    mean_ndre=indices.get("ndre"),
                    mean_ndwi=indices.get("ndwi"),
                    mean_evi=indices.get("evi"),
                    mean_savi=indices.get("savi"),
                    extra_metadata={"image_id": img.get("id"), "pipeline": "auto_crop_risk"},
                )
                db.add(sat_image)
                db.commit()
            except Exception as exc:
                logger.warning(f"Failed to persist satellite image: {exc}")
                db.rollback()

            return indices

        # Fallback: use latest DB record
        logger.info(f"No new imagery — falling back to DB for farm {farm.id}")
        return self._get_indices_from_db(db, farm.id)

    def _get_indices_from_db(self, db: Session, farm_id: int) -> Dict[str, Optional[float]]:
        """Retrieve most recent vegetation indices from the database."""
        sat = (
            db.query(SatelliteImage)
            .filter(SatelliteImage.farm_id == farm_id)
            .order_by(SatelliteImage.date.desc())
            .first()
        )
        if sat:
            return {
                "ndvi": sat.mean_ndvi,
                "ndre": sat.mean_ndre,
                "ndwi": sat.mean_ndwi,
                "evi": sat.mean_evi,
                "savi": sat.mean_savi,
            }
        # Also try vegetation health table
        vh = (
            db.query(VegetationHealth)
            .filter(VegetationHealth.farm_id == farm_id)
            .order_by(VegetationHealth.date.desc())
            .first()
        )
        if vh:
            return {
                "ndvi": vh.ndvi,
                "ndre": vh.ndre,
                "ndwi": vh.ndwi,
                "evi": vh.evi,
                "savi": vh.savi,
            }
        logger.warning(f"No vegetation data at all for farm {farm_id}")
        return {"ndvi": None, "ndre": None, "ndwi": None, "evi": None, "savi": None}

    def _get_latest_weather(
        self, db: Session, farm_id: int, lat: float, lon: float
    ) -> Dict:
        """Get most recent weather data for disease models."""
        recent = (
            db.query(WeatherRecord)
            .filter(WeatherRecord.farm_id == farm_id)
            .order_by(WeatherRecord.date.desc())
            .first()
        )
        if recent:
            return {
                "temperature": recent.temperature,
                "humidity": recent.humidity,
                "rainfall": recent.rainfall,
                "wind_speed": recent.wind_speed,
                "leaf_wetness": getattr(recent, "leaf_wetness", None) or 0.5,
            }

        # Fallback: try Open-Meteo for current conditions
        try:
            import openmeteo_requests
            import requests_cache
            from retry_requests import retry

            cache_session = requests_cache.CachedSession(".cache", expire_after=3600)
            retry_session = retry(cache_session, retries=3, backoff_factor=0.2)
            om = openmeteo_requests.Client(session=retry_session)

            resp = om.weather_api(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current_weather": True,
                },
            )
            current = resp[0].Current() if resp else None
            if current:
                return {
                    "temperature": current.Variables(0).Value(),  # temp
                    "humidity": 70,  # Open-Meteo current doesn't always have RH
                    "rainfall": 0,
                    "wind_speed": current.Variables(1).Value() if current.VariablesLength() > 1 else 3,
                    "leaf_wetness": 0.5,
                }
        except Exception as exc:
            logger.warning(f"Open-Meteo fallback failed: {exc}")

        # Ultimate fallback — Rwanda seasonal defaults
        return {
            "temperature": 22.0,
            "humidity": 70.0,
            "rainfall": 2.0,
            "wind_speed": 3.0,
            "leaf_wetness": 0.5,
        }

    def _run_disease_models(
        self, weather_data: Dict, crop_type: Optional[str]
    ) -> List[Dict]:
        """Run all four disease risk models."""
        results = []
        try:
            results.append(
                self.disease_engine.predict_late_blight(weather_data, crop_type=crop_type or "potato")
            )
        except Exception as exc:
            logger.warning(f"Late Blight model failed: {exc}")

        try:
            results.append(
                self.disease_engine.predict_septoria_leaf_spot(weather_data, crop_type=crop_type or "tomato")
            )
        except Exception as exc:
            logger.warning(f"Septoria model failed: {exc}")

        try:
            results.append(
                self.disease_engine.predict_powdery_mildew(weather_data, crop_type=crop_type or "wheat")
            )
        except Exception as exc:
            logger.warning(f"Powdery Mildew model failed: {exc}")

        try:
            results.append(
                self.disease_engine.predict_fusarium_wilt(weather_data, crop_type=crop_type or "tomato")
            )
        except Exception as exc:
            logger.warning(f"Fusarium Wilt model failed: {exc}")

        return results

    def _persist_health_record(
        self,
        db: Session,
        farm: Farm,
        indices: Dict[str, Optional[float]],
        composite_score: float,
        health_status: str,
    ):
        """Upsert a VegetationHealth record for today."""
        today = datetime.utcnow().date()
        existing = (
            db.query(VegetationHealth)
            .filter(VegetationHealth.farm_id == farm.id, VegetationHealth.date == today)
            .first()
        )

        stress_level_map = {"Healthy": "none", "Moderate Stress": "moderate", "High Stress": "severe"}

        if existing:
            existing.ndvi = indices.get("ndvi")
            existing.ndre = indices.get("ndre")
            existing.ndwi = indices.get("ndwi")
            existing.evi = indices.get("evi")
            existing.savi = indices.get("savi")
            existing.health_score = composite_score
            existing.stress_level = stress_level_map.get(health_status, "unknown")
        else:
            vh = VegetationHealth(
                farm_id=farm.id,
                date=today,
                ndvi=indices.get("ndvi"),
                ndre=indices.get("ndre"),
                ndwi=indices.get("ndwi"),
                evi=indices.get("evi"),
                savi=indices.get("savi"),
                health_score=composite_score,
                stress_level=stress_level_map.get(health_status, "unknown"),
            )
            db.add(vh)

        try:
            db.commit()
        except Exception as exc:
            logger.warning(f"Failed to persist health record: {exc}")
            db.rollback()
