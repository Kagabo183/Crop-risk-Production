from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Dict, List, Any
from datetime import datetime, timedelta
from app.db.database import get_db
from app.models.prediction import Prediction as PredictionModel
from app.models.alert import Alert as AlertModel
from app.models.farm import Farm as FarmModel
from app.models.data import SatelliteImage, WeatherRecord
from sqlalchemy import text

router = APIRouter()


def _ndvi_to_risk_score(ndvi: float) -> float:
    """Convert NDVI to risk score (0-100, higher = more risk)."""
    if ndvi is None:
        return 0.0
    try:
        value = float(ndvi)
    except Exception:
        return 0.0

    if value >= 0.7:
        return 10.0
    elif value >= 0.6:
        return 25.0
    elif value >= 0.5:
        return 40.0
    elif value >= 0.4:
        return 55.0
    elif value >= 0.3:
        return 70.0
    elif value >= 0.2:
        return 85.0
    else:
        return 95.0


def _latest_satellite_per_farm(db: Session) -> List[Dict[str, Any]]:
    """Return latest satellite NDVI per farm using extra_metadata.farm_id linkage."""
    rows = db.execute(
        text(
            """
            SELECT farm_id, ndvi, date
            FROM (
                SELECT
                    (extra_metadata->>'farm_id')::int AS farm_id,
                    date,
                    COALESCE(
                        NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                        (extra_metadata->>'ndvi_mean')::float
                    ) AS ndvi,
                    ROW_NUMBER() OVER (
                        PARTITION BY (extra_metadata->>'farm_id')::int
                        ORDER BY date DESC, id DESC
                    ) AS rn
                FROM satellite_images
                WHERE (extra_metadata->>'farm_id') IS NOT NULL
            ) t
            WHERE rn = 1
            """
        )
    ).fetchall()

    latest = []
    for r in rows:
        if not r or r[0] is None:
            continue
        latest.append({"farm_id": int(r[0]), "ndvi": r[1], "date": r[2]})
    return latest

def calculate_time_to_impact(risk_score: float) -> str:
    """Calculate time to impact based on risk score"""
    if risk_score >= 80:
        return "< 7 days"
    elif risk_score >= 60:
        return "7-14 days"
    elif risk_score >= 40:
        return "14-30 days"
    else:
        return "> 30 days (Stable)"

def calculate_confidence(risk_score: float, has_satellite_data: bool = True, has_weather_data: bool = True) -> tuple:
    """Deterministic confidence estimate when a prediction doesn't store it.

    If you want "real" confidence, store it on the Prediction row during inference.
    """
    base_confidence = 55.0

    if has_satellite_data:
        base_confidence += 20.0
    if has_weather_data:
        base_confidence += 10.0

    # Mid-range risk tends to be more stable.
    if 40 <= risk_score <= 60:
        base_confidence += 5.0

    confidence_score = max(0.0, min(95.0, base_confidence))

    if confidence_score >= 80:
        confidence_level = "High"
    elif confidence_score >= 60:
        confidence_level = "Medium"
    else:
        confidence_level = "Low"

    return confidence_level, round(confidence_score, 1)

def calculate_impact_metrics(risk_score: float, farm_area_ha: float = 1.0) -> Dict[str, float]:
    """Calculate economic and food security impact"""
    # Average potato yield in Rwanda: ~15 tons/ha
    # Average price: ~$300/ton
    # 1 ton feeds approximately 2000 meals (500g per meal)
    
    yield_loss_percent = risk_score / 100.0
    yield_loss_tons = farm_area_ha * 15 * yield_loss_percent
    economic_loss_usd = yield_loss_tons * 300
    meals_lost = yield_loss_tons * 2000
    
    return {
        "economic_loss_usd": round(economic_loss_usd, 2),
        "yield_loss_tons": round(yield_loss_tons, 2),
        "meals_lost": int(meals_lost),
        "affected_area_ha": round(farm_area_ha * yield_loss_percent, 2)
    }

def default_risk_drivers(risk_score: float) -> Dict[str, float]:
    """Deterministic fallback drivers when a prediction doesn't store drivers."""
    if risk_score >= 60:
        return {
            "ndvi_trend": 0.35,
            "rainfall_deficit": 0.25,
            "heat_stress_days": 0.25,
            "disease_pressure": 0.15,
        }
    if risk_score >= 30:
        return {
            "ndvi_anomaly": 0.4,
            "rainfall_deficit": 0.3,
            "heat_stress_days": 0.3,
        }
    return {"seasonal_variation": 1.0}


def _latest_predictions_per_farm(db: Session) -> List[PredictionModel]:
    subq = (
        db.query(
            PredictionModel.farm_id.label("farm_id"),
            func.max(PredictionModel.predicted_at).label("max_predicted_at"),
        )
        .group_by(PredictionModel.farm_id)
        .subquery()
    )
    return (
        db.query(PredictionModel)
        .join(
            subq,
            (PredictionModel.farm_id == subq.c.farm_id)
            & (PredictionModel.predicted_at == subq.c.max_predicted_at),
        )
        .all()
    )

@router.get("/dashboard-metrics")
def get_dashboard_metrics(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Get comprehensive dashboard analytics with intelligence metrics"""

    # Dashboard should represent the *current state*. If predictions are older than
    # the most recent satellite imagery, derive the dashboard metrics from satellite.
    predictions = _latest_predictions_per_farm(db)

    latest_predicted_at = None
    try:
        latest_predicted_at = max((p.predicted_at for p in predictions if p.predicted_at), default=None)
    except Exception:
        latest_predicted_at = None

    latest_predicted_day = None
    try:
        latest_predicted_day = latest_predicted_at.date() if latest_predicted_at else None
    except Exception:
        latest_predicted_day = None

    latest_satellite_at = None
    try:
        latest_satellite_at = db.execute(
            text("SELECT MAX(date) FROM satellite_images WHERE (extra_metadata->>'farm_id') IS NOT NULL")
        ).scalar()
    except Exception:
        latest_satellite_at = None

    use_satellite = bool(
        latest_satellite_at
        and (
            (latest_predicted_at is None)
            or (latest_predicted_day and latest_predicted_day < latest_satellite_at)
        )
    )

    satellite_latest = _latest_satellite_per_farm(db) if use_satellite else []
    if use_satellite and not satellite_latest:
        use_satellite = False
    
    if (not predictions) and (not satellite_latest):
        # Return zeros if no data
        return {
            "total_predictions": 0,
            "metrics_source": None,
            "latest_prediction_at": None,
            "latest_satellite_at": latest_satellite_at.isoformat() if latest_satellite_at else None,
            "effective_last_updated_at": latest_satellite_at.isoformat() if latest_satellite_at else None,
            "stale_predictions": bool(latest_satellite_at and latest_predicted_day and latest_predicted_day < latest_satellite_at),
            "time_to_impact": {
                "immediate": 0,
                "short_term": 0,
                "medium_term": 0,
                "stable": 0
            },
            "confidence": {
                "average": 0.0,
                "high_confidence_count": 0
            },
            "national_impact": {
                "economic_loss_usd": 0,
                "yield_loss_tons": 0,
                "meals_lost": 0
            },
            "risk_distribution": {
                "high": 0,
                "medium": 0,
                "low": 0
            },
            "top_risk_drivers": []
        }
    
    # Calculate metrics
    immediate_count = 0
    short_term_count = 0
    medium_term_count = 0
    stable_count = 0
    
    total_confidence = 0
    high_confidence_count = 0
    
    total_economic_loss = 0
    total_yield_loss = 0
    total_meals_lost = 0
    
    high_risk_count = 0
    medium_risk_count = 0
    low_risk_count = 0
    
    risk_drivers_counter: Dict[str, int] = {}
    
    # Get farm areas for impact calculation
    farm_areas = {farm.id: farm.area or 1.0 for farm in db.query(FarmModel).all()}
    
    # Determine basic data availability flags once.
    has_any_weather = db.query(func.count(WeatherRecord.id)).scalar() not in (None, 0)

    # Get list of farms that have at least one satellite image linked via extra_metadata.farm_id
    farms_with_satellite = set()
    try:
        rows = db.execute(
            text(
                """
                SELECT DISTINCT (extra_metadata->>'farm_id')::int AS farm_id
                FROM satellite_images
                WHERE (extra_metadata->>'farm_id') IS NOT NULL
                """
            )
        ).fetchall()
        farms_with_satellite = {int(r[0]) for r in rows if r and r[0] is not None}
    except Exception:
        farms_with_satellite = set()

    metrics_source = "satellite" if use_satellite else "predictions"
    effective_last_updated_at = latest_satellite_at if use_satellite else latest_predicted_at

    if use_satellite:
        for row in satellite_latest:
            farm_id = int(row["farm_id"])
            risk_score = _ndvi_to_risk_score(row.get("ndvi"))
            farm_area = farm_areas.get(farm_id, 1.0)

            # Time to impact
            time_to_impact = calculate_time_to_impact(risk_score)
            if "< 7" in time_to_impact:
                immediate_count += 1
            elif "7-14" in time_to_impact:
                short_term_count += 1
            elif "14-30" in time_to_impact:
                medium_term_count += 1
            else:
                stable_count += 1

            # Confidence (derived)
            confidence_level, confidence_score = calculate_confidence(
                risk_score,
                has_satellite_data=True,
                has_weather_data=has_any_weather,
            )

            total_confidence += confidence_score
            if confidence_level.lower() == "high":
                high_confidence_count += 1

            # Impact metrics
            impact = calculate_impact_metrics(risk_score, farm_area)
            total_economic_loss += impact["economic_loss_usd"]
            total_yield_loss += impact["yield_loss_tons"]
            total_meals_lost += impact["meals_lost"]

            # Risk distribution
            if risk_score >= 60:
                high_risk_count += 1
            elif risk_score >= 30:
                medium_risk_count += 1
            else:
                low_risk_count += 1

            # Risk drivers (derived)
            drivers = default_risk_drivers(risk_score)
            for driver in drivers.keys():
                risk_drivers_counter[driver] = risk_drivers_counter.get(driver, 0) + 1

    else:
        for pred in predictions:
            risk_score = float(pred.risk_score or 0)
            farm_area = farm_areas.get(pred.farm_id, 1.0)

            # Time to impact
            time_to_impact = calculate_time_to_impact(risk_score)
            if "< 7" in time_to_impact:
                immediate_count += 1
            elif "7-14" in time_to_impact:
                short_term_count += 1
            elif "14-30" in time_to_impact:
                medium_term_count += 1
            else:
                stable_count += 1

            # Confidence (prefer persisted values)
            if pred.confidence_score is not None and pred.confidence_level:
                confidence_score = float(pred.confidence_score)
                confidence_level = str(pred.confidence_level)
            else:
                has_sat = pred.farm_id in farms_with_satellite
                confidence_level, confidence_score = calculate_confidence(
                    risk_score,
                    has_satellite_data=has_sat,
                    has_weather_data=has_any_weather,
                )

            total_confidence += confidence_score
            if confidence_level.lower() == "high":
                high_confidence_count += 1

            # Impact metrics
            impact = calculate_impact_metrics(risk_score, farm_area)
            total_economic_loss += impact["economic_loss_usd"]
            total_yield_loss += impact["yield_loss_tons"]
            total_meals_lost += impact["meals_lost"]

            # Risk distribution
            if risk_score >= 60:
                high_risk_count += 1
            elif risk_score >= 30:
                medium_risk_count += 1
            else:
                low_risk_count += 1

            # Risk drivers (prefer persisted drivers)
            drivers = (
                pred.risk_drivers
                if isinstance(pred.risk_drivers, dict) and pred.risk_drivers
                else default_risk_drivers(risk_score)
            )
            for driver in drivers.keys():
                risk_drivers_counter[driver] = risk_drivers_counter.get(driver, 0) + 1
    
    # Calculate averages
    denom = len(satellite_latest) if use_satellite else len(predictions)
    avg_confidence = total_confidence / denom if denom else 0
    
    # Top risk drivers
    top_drivers = sorted(risk_drivers_counter.items(), key=lambda x: x[1], reverse=True)[:3]
    
    return {
        "total_predictions": denom,
        "metrics_source": metrics_source,
        "latest_prediction_at": latest_predicted_at.isoformat() if latest_predicted_at else None,
        "latest_satellite_at": latest_satellite_at.isoformat() if latest_satellite_at else None,
        "effective_last_updated_at": effective_last_updated_at.isoformat() if effective_last_updated_at else None,
        "stale_predictions": bool(latest_satellite_at and latest_predicted_day and latest_predicted_day < latest_satellite_at),
        "time_to_impact": {
            "immediate": immediate_count,
            "short_term": short_term_count,
            "medium_term": medium_term_count,
            "stable": stable_count
        },
        "confidence": {
            "average": round(avg_confidence, 1),
            "high_confidence_count": high_confidence_count
        },
        "national_impact": {
            "economic_loss_usd": round(total_economic_loss, 0),
            "yield_loss_tons": round(total_yield_loss, 1),
            "meals_lost": int(total_meals_lost)
        },
        "risk_distribution": {
            "high": high_risk_count,
            "medium": medium_risk_count,
            "low": low_risk_count
        },
        "top_risk_drivers": [{"name": driver, "count": count} for driver, count in top_drivers]
    }

@router.get("/predictions-enriched")
def get_enriched_predictions(db: Session = Depends(get_db)):
    """Get predictions with calculated intelligence metrics"""

    # "Soft" data-quality checks to keep results trustworthy.
    # Sentinel-2 captures everything (cities/lakes/etc). We only get "farm" values
    # by sampling pixels at a farm point or within a farm polygon. If the farm has
    # missing/incorrect geometry, NDVI can reflect non-farm land cover.

    RWANDA_BBOX = {
        "min_lon": 28.8,
        "max_lon": 30.9,
        "min_lat": -2.9,
        "max_lat": -1.0,
    }

    def _in_rwanda_bounds(lat: float, lon: float) -> bool:
        return (
            RWANDA_BBOX["min_lat"] <= lat <= RWANDA_BBOX["max_lat"]
            and RWANDA_BBOX["min_lon"] <= lon <= RWANDA_BBOX["max_lon"]
        )

    def _compute_quality_flags(*, farm: FarmModel, ndvi_series: list[dict]) -> list[str]:
        flags: list[str] = []

        has_boundary = getattr(farm, "boundary", None) is not None
        lat = getattr(farm, "latitude", None)
        lon = getattr(farm, "longitude", None)

        if (lat is None or lon is None) and not has_boundary:
            flags.append("missing_farm_geometry")
        elif lat is not None and lon is not None:
            try:
                if not _in_rwanda_bounds(float(lat), float(lon)):
                    flags.append("farm_out_of_rwanda_bounds")
            except Exception:
                flags.append("invalid_farm_coordinates")

        if not ndvi_series:
            flags.append("no_satellite_ndvi")
            return flags

        # ndvi_series is ordered most-recent-first
        try:
            latest_ndvi = float(ndvi_series[0]["ndvi"])
        except Exception:
            flags.append("invalid_satellite_ndvi")
            return flags

        # Very low NDVI often indicates water/urban/bare soil; can be real during off-season,
        # but should be reviewed if persistent.
        if latest_ndvi <= 0.05:
            flags.append("ndvi_suspicious_low")
        if latest_ndvi >= 0.95:
            flags.append("ndvi_suspicious_high")

        if len(ndvi_series) >= 2:
            try:
                prev_ndvi = float(ndvi_series[1]["ndvi"])
                if abs(latest_ndvi - prev_ndvi) >= 0.40:
                    flags.append("ndvi_unstable")
            except Exception:
                pass

        return flags

    predictions = _latest_predictions_per_farm(db)

    farms = db.query(FarmModel).all()
    farms_by_id = {f.id: f for f in farms}
    farm_areas = {farm.id: farm.area or 1.0 for farm in farms}

    # Pull up to 5 most recent NDVI values per farm from satellite_images (linked by extra_metadata.farm_id)
    ndvi_by_farm: dict[int, list[dict]] = {}
    try:
        rows = db.execute(
            text(
                """
                WITH s AS (
                    SELECT
                        (extra_metadata->>'farm_id')::int AS farm_id,
                        date,
                        COALESCE(
                            NULLIF((extra_metadata->>'ndvi_value')::float, 0),
                            (extra_metadata->>'ndvi_mean')::float
                        ) AS ndvi,
                        row_number() OVER (
                            PARTITION BY (extra_metadata->>'farm_id')::int
                            ORDER BY date DESC NULLS LAST, id DESC
                        ) AS rn
                    FROM satellite_images
                    WHERE (extra_metadata->>'farm_id') IS NOT NULL
                )
                SELECT farm_id, date, ndvi
                FROM s
                WHERE rn <= 5 AND ndvi IS NOT NULL
                ORDER BY farm_id, rn
                """
            )
        ).fetchall()

        for r in rows:
            farm_id = int(r[0])
            ndvi_by_farm.setdefault(farm_id, []).append(
                {
                    "date": r[1].isoformat() if r[1] else None,
                    "ndvi": float(r[2]) if r[2] is not None else None,
                }
            )
    except Exception:
        ndvi_by_farm = {}

    has_any_weather = db.query(func.count(WeatherRecord.id)).scalar() not in (None, 0)
    farms_with_satellite = set()
    try:
        rows = db.execute(
            text(
                """
                SELECT DISTINCT (extra_metadata->>'farm_id')::int AS farm_id
                FROM satellite_images
                WHERE (extra_metadata->>'farm_id') IS NOT NULL
                """
            )
        ).fetchall()
        farms_with_satellite = {int(r[0]) for r in rows if r and r[0] is not None}
    except Exception:
        farms_with_satellite = set()
    
    enriched = []
    for pred in predictions:
        farm_area = farm_areas.get(pred.farm_id, 1.0)
        farm = farms_by_id.get(pred.farm_id)
        ndvi_series = ndvi_by_farm.get(int(pred.farm_id), []) if pred.farm_id is not None else []
        quality_flags = _compute_quality_flags(farm=farm, ndvi_series=ndvi_series) if farm else ["missing_farm_record"]

        risk_score = float(pred.risk_score or 0)
        time_to_impact = pred.time_to_impact or calculate_time_to_impact(risk_score)

        if pred.confidence_score is not None and pred.confidence_level:
            confidence_level = str(pred.confidence_level)
            confidence_score = float(pred.confidence_score)
        else:
            has_sat = pred.farm_id in farms_with_satellite
            confidence_level, confidence_score = calculate_confidence(risk_score, has_satellite_data=has_sat, has_weather_data=has_any_weather)

        drivers = pred.risk_drivers if isinstance(pred.risk_drivers, dict) and pred.risk_drivers else default_risk_drivers(risk_score)
        impact = pred.impact_metrics if isinstance(pred.impact_metrics, dict) and pred.impact_metrics else calculate_impact_metrics(risk_score, farm_area)
        
        enriched.append({
            "id": pred.id,
            "farm_id": pred.farm_id,
            "risk_score": pred.risk_score,
            "yield_loss": pred.yield_loss,
            "disease_risk": pred.disease_risk,
            "predicted_at": pred.predicted_at.isoformat() if pred.predicted_at else None,
            "time_to_impact": time_to_impact,
            "confidence_level": confidence_level,
            "confidence_score": confidence_score,
            "risk_drivers": drivers,
            "impact_metrics": impact,
            "latest_ndvi": (ndvi_series[0]["ndvi"] if ndvi_series else None),
            "latest_ndvi_date": (ndvi_series[0]["date"] if ndvi_series else None),
            "data_quality": {
                "flags": quality_flags,
                "has_warnings": bool(quality_flags),
            },
        })
    
    return enriched
