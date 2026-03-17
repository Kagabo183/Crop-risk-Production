"""
Early Warning System — Weather-disease correlation + pre-symptomatic detection
Combines: NDVI anomaly detection, weather disease risk, growth stage susceptibility
"""
import logging
from datetime import datetime, timedelta, date
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.db.database import get_db
from app.models.farm import Farm
from app.models.data import SatelliteImage, WeatherRecord, FarmVegetationMetric
from app.core.auth import get_current_active_user
from app.models.user import User as UserModel

logger = logging.getLogger(__name__)
router = APIRouter()


def _fetch_realtime_weather(lat: float, lon: float) -> dict:
    """Fetch current weather from Open-Meteo (free, no API key)."""
    import requests as _requests
    try:
        resp = _requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current_weather": True,
                "hourly": "relative_humidity_2m,precipitation",
                "timezone": "auto",
                "forecast_days": 1,
            },
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        cw = data.get("current_weather", {})
        hourly = data.get("hourly", {})
        humidity_vals = hourly.get("relative_humidity_2m", [])
        precip_vals = hourly.get("precipitation", [])
        return {
            "temperature": cw.get("temperature", 22),
            "humidity": round(sum(humidity_vals) / max(len(humidity_vals), 1), 1) if humidity_vals else 70,
            "rainfall": round(sum(precip_vals), 2) if precip_vals else 0,
        }
    except Exception as exc:
        logger.warning("Open-Meteo realtime fetch failed: %s", exc)
        return {"temperature": 22, "humidity": 72, "rainfall": 2}


# Growth stages with disease susceptibility multiplier (1.0 = normal, higher = more susceptible)
STAGE_SUSCEPTIBILITY = {
    "germination": 0.6,
    "seedling": 1.2,
    "establishment": 0.9,
    "vegetative": 0.8,
    "flowering": 1.5,   # Most vulnerable
    "fruiting": 1.3,
    "pod_fill": 1.2,
    "grain_fill": 1.1,
    "tuber_fill": 1.0,
    "maturity": 0.5,
    "harvest_ready": 0.4,
    "unknown": 1.0,
    "not_planted": 0.1,
}


def _ndvi_anomaly(ndvi_series: List[float]) -> Dict[str, Any]:
    """Detect significant NDVI drops (pre-symptomatic stress signal)."""
    if len(ndvi_series) < 3:
        return {"detected": False, "drop_pct": 0, "trend": "insufficient_data"}

    recent = ndvi_series[-1]
    baseline = sum(ndvi_series[:-1]) / len(ndvi_series[:-1])

    if baseline == 0:
        return {"detected": False, "drop_pct": 0, "trend": "no_baseline"}

    drop_pct = round((baseline - recent) / baseline * 100, 1)

    if drop_pct > 15:
        trend = "sharp_decline"
    elif drop_pct > 8:
        trend = "declining"
    elif drop_pct < -5:
        trend = "improving"
    else:
        trend = "stable"

    return {
        "detected": drop_pct > 10,
        "drop_pct": drop_pct,
        "trend": trend,
        "current_ndvi": round(recent, 4),
        "baseline_ndvi": round(baseline, 4),
    }


def _weather_disease_risk(weather: Dict) -> Dict[str, Any]:
    """Calculate disease risk from weather conditions."""
    temp = weather.get("temperature", 22)
    humidity = weather.get("humidity", 70)
    rainfall = weather.get("rainfall", 0)

    # Estimate leaf wetness from humidity
    leaf_wetness = max(0, (humidity - 80) / 20.0) if humidity > 80 else 0

    # Fungal risk: 15-25°C, >80% humidity
    fungal = 0
    if 15 <= temp <= 25:
        fungal = 1.0
    elif 10 <= temp < 15 or 25 < temp <= 30:
        fungal = 0.7
    else:
        fungal = 0.3
    fungal = (fungal * 0.4 + max(0, (humidity - 60) / 40) * 0.3 + leaf_wetness * 0.3) * 100

    # Bacterial risk: 25-30°C, rainfall
    bacterial = 0
    if 25 <= temp <= 30:
        bacterial = 1.0
    elif 20 <= temp < 25 or 30 < temp <= 35:
        bacterial = 0.7
    else:
        bacterial = 0.4
    bacterial = (bacterial * 0.3 + min(1, rainfall / 10) * 0.4 + leaf_wetness * 0.3) * 100

    # Late blight: 10-25°C + >90% humidity (Smith Period)
    late_blight = 0
    if temp >= 10 and humidity > 90:
        late_blight = min(100, (humidity - 90) * 10 + rainfall * 5)
    elif temp >= 15 and humidity > 80:
        late_blight = (humidity - 80) * 3

    overall = round(max(fungal, bacterial, late_blight), 1)
    primary = "fungal" if fungal >= bacterial and fungal >= late_blight else (
        "late_blight" if late_blight >= bacterial else "bacterial"
    )

    return {
        "overall_risk": overall,
        "fungal_risk": round(fungal, 1),
        "bacterial_risk": round(bacterial, 1),
        "late_blight_risk": round(late_blight, 1),
        "primary_threat": primary,
        "conditions": {
            "temperature": temp,
            "humidity": humidity,
            "rainfall": rainfall,
            "leaf_wetness_est": round(leaf_wetness, 2),
        },
    }


def _classify_alert(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 30:
        return "moderate"
    return "low"


@router.get("/")
def get_early_warnings(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Generate early warning alerts for all farms by combining:
    1. NDVI anomaly detection (pre-symptomatic)
    2. Weather-disease risk correlation
    3. Growth stage susceptibility
    """
    from app.api.v1.endpoints.farms import compute_growth_stage

    query = db.query(Farm)
    if current_user.role == "farmer":
        query = query.filter(Farm.owner_id == current_user.id)
    elif current_user.role == "agronomist" and current_user.district:
        query = query.filter(Farm.location == current_user.district)
        
    farms = query.all()
    if not farms:
        return {"alerts": [], "summary": {}}

    alerts = []

    for farm in farms:
        # 1. Get last 6 NDVI observations (check both SatelliteImage and FarmVegetationMetric)
        sat_records = (
            db.query(SatelliteImage)
            .filter(SatelliteImage.farm_id == farm.id)
            .order_by(desc(SatelliteImage.date))
            .limit(6)
            .all()
        )
        ndvi_series = [s.mean_ndvi for s in reversed(sat_records) if s.mean_ndvi is not None]

        # Fall back to FarmVegetationMetric (populated by quick_scan)
        if len(ndvi_series) < 3:
            veg_records = (
                db.query(FarmVegetationMetric)
                .filter(FarmVegetationMetric.farm_id == farm.id)
                .order_by(desc(FarmVegetationMetric.observation_date))
                .limit(6)
                .all()
            )
            veg_ndvi = [v.ndvi_mean for v in reversed(veg_records) if v.ndvi_mean is not None]
            if len(veg_ndvi) > len(ndvi_series):
                ndvi_series = veg_ndvi

        ndvi_result = _ndvi_anomaly(ndvi_series)

        # 2. Get latest weather (from DB or real-time Open-Meteo)
        weather_rec = (
            db.query(WeatherRecord)
            .filter(WeatherRecord.farm_id == farm.id)
            .order_by(desc(WeatherRecord.date))
            .first()
        )
        weather = {}
        if weather_rec:
            weather = {
                "temperature": weather_rec.temperature or 22,
                "humidity": (weather_rec.extra_metadata or {}).get("humidity", weather_rec.humidity or 70),
                "rainfall": weather_rec.rainfall or 0,
            }
        elif farm.latitude and farm.longitude:
            # Fetch real-time weather from Open-Meteo (free, no API key)
            weather = _fetch_realtime_weather(farm.latitude, farm.longitude)
            # Store for future queries
            try:
                new_rec = WeatherRecord(
                    farm_id=farm.id,
                    date=datetime.utcnow().date(),
                    region=farm.location or f"Lat:{farm.latitude:.2f},Lon:{farm.longitude:.2f}",
                    rainfall=weather.get("rainfall"),
                    temperature=weather.get("temperature"),
                    humidity=weather.get("humidity"),
                    source="open-meteo-realtime",
                    extra_metadata={"humidity": weather.get("humidity")},
                )
                db.add(new_rec)
                db.commit()
            except Exception:
                db.rollback()
        else:
            weather = {"temperature": 22, "humidity": 72, "rainfall": 2}

        disease_risk = _weather_disease_risk(weather)

        # 3. Growth stage susceptibility
        gs = compute_growth_stage(farm.crop_type, farm.planting_date)
        susceptibility = STAGE_SUSCEPTIBILITY.get(gs["stage"], 1.0)

        # 4. Combine into final alert score
        ndvi_component = min(100, ndvi_result["drop_pct"] * 3) if ndvi_result["detected"] else 0
        weather_component = disease_risk["overall_risk"]
        combined_score = round(
            (weather_component * 0.5 + ndvi_component * 0.3) * susceptibility + (susceptibility - 1) * 10,
            1,
        )
        combined_score = max(0, min(100, combined_score))

        alert_level = _classify_alert(combined_score)

        # Build recommendations
        recommendations = []
        if ndvi_result["detected"]:
            recommendations.append(f"NDVI dropped {ndvi_result['drop_pct']}% — scout for early disease symptoms")
        if disease_risk["fungal_risk"] > 60:
            recommendations.append("High fungal risk — consider preventive fungicide application")
        if disease_risk["late_blight_risk"] > 50:
            recommendations.append("Late blight conditions present — apply Mancozeb/Chlorothalonil")
        if disease_risk["bacterial_risk"] > 60:
            recommendations.append("Bacterial disease risk elevated — avoid overhead irrigation")
        if susceptibility >= 1.3:
            recommendations.append(f"Crop in {gs['stage']} stage — highest disease vulnerability")
        if not recommendations:
            recommendations.append("No immediate action required — continue routine monitoring")

        alerts.append({
            "farm_id": farm.id,
            "farm_name": farm.name,
            "location": farm.location,
            "crop_type": farm.crop_type,
            "alert_level": alert_level,
            "combined_score": combined_score,
            "ndvi_anomaly": ndvi_result,
            "disease_risk": disease_risk,
            "growth_stage": gs,
            "susceptibility_multiplier": susceptibility,
            "recommendations": recommendations,
        })

    # Sort by combined score descending
    alerts.sort(key=lambda a: a["combined_score"], reverse=True)

    # Summary
    levels = {"critical": 0, "high": 0, "moderate": 0, "low": 0}
    for a in alerts:
        levels[a["alert_level"]] += 1

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "total_farms": len(alerts),
        "summary": levels,
        "alerts": alerts,
    }


@router.post("/fetch-weather")
def fetch_weather_all_farms(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    Fetch current weather from Open-Meteo for all farms and store in DB.
    This enriches the early warning system with real weather data.
    """
    try:
        from app.services.weather_service import WeatherDataIntegrator, store_weather_data
    except ImportError:
        raise HTTPException(status_code=500, detail="Weather service not available")

    farms = db.query(Farm).filter(Farm.latitude.isnot(None), Farm.longitude.isnot(None)).all()
    if not farms:
        raise HTTPException(status_code=404, detail="No farms with coordinates")

    weather_service = WeatherDataIntegrator()
    now = datetime.now()
    fetched = 0
    errors = 0

    for farm in farms:
        try:
            data = weather_service.fetch_openmeteo_data(
                farm.latitude, farm.longitude, now - timedelta(days=1), now
            )
            risk_factors = weather_service.calculate_disease_risk_factors(data)
            data["disease_risk_factors"] = risk_factors

            record = WeatherRecord(
                farm_id=farm.id,
                date=now.date(),
                region=farm.location or f"Lat:{farm.latitude:.2f},Lon:{farm.longitude:.2f}",
                rainfall=data.get("rainfall"),
                temperature=data.get("temperature"),
                humidity=data.get("humidity"),
                wind_speed=data.get("wind_speed"),
                source="open-meteo",
                extra_metadata={
                    "humidity": data.get("humidity"),
                    "dewpoint": data.get("dewpoint"),
                    "pressure": data.get("pressure"),
                    "disease_risk_factors": risk_factors,
                },
            )
            db.add(record)
            fetched += 1
        except Exception as e:
            logger.warning(f"Weather fetch failed for farm {farm.id}: {e}")
            errors += 1

    db.commit()

    return {
        "status": "completed",
        "farms_fetched": fetched,
        "errors": errors,
        "date": now.date().isoformat(),
    }
