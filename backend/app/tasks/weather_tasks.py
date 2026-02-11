"""
Celery tasks for automated weather data fetching and processing
Fetches from multiple sources: Open-Meteo (free), ERA5, NOAA
Critical for disease prediction models
"""
from celery import shared_task
from datetime import datetime, timedelta
from typing import Dict, List
from app.db.database import SessionLocal
from app.services.weather_service import WeatherDataIntegrator, store_weather_data
from app.models.farm import Farm
from app.models.data import WeatherRecord
from app.models.alert import Alert
from sqlalchemy import func
import logging

logger = logging.getLogger(__name__)


@shared_task(name="weather.fetch_all_farms_weather")
def fetch_all_farms_weather():
    """
    Fetch current weather data for all farms
    Scheduled to run every 6 hours for fresh disease prediction data

    Returns:
        Dict with success/failure counts
    """
    db = SessionLocal()
    try:
        weather_service = WeatherDataIntegrator()

        # Get all farms with coordinates
        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None),
            Farm.longitude.isnot(None)
        ).all()

        logger.info(f"Fetching weather data for {len(farms)} farms")

        results = {
            'farms_processed': 0,
            'records_created': 0,
            'high_risk_alerts': 0,
            'errors': 0
        }

        today = datetime.now()
        yesterday = today - timedelta(days=1)

        for farm in farms:
            try:
                # Fetch integrated weather data from multiple sources
                weather_data = weather_service.integrate_multi_source_data(
                    lat=farm.latitude,
                    lon=farm.longitude,
                    start_date=yesterday,
                    end_date=today
                )

                # Calculate disease risk factors
                risk_factors = weather_service.calculate_disease_risk_factors(weather_data)
                weather_data['disease_risk_factors'] = risk_factors

                # Store in database
                record = store_weather_data(
                    db=db,
                    weather_data=weather_data,
                    lat=farm.latitude,
                    lon=farm.longitude,
                    date=today
                )

                results['farms_processed'] += 1
                results['records_created'] += 1

                # Create alerts for high disease risk conditions
                if risk_factors.get('late_blight_risk', 0) >= 70:
                    _create_weather_alert(
                        db, farm.id,
                        f"High Late Blight risk ({risk_factors['late_blight_risk']:.0f}%). "
                        f"Conditions: {weather_data.get('temperature', 0):.1f}°C, "
                        f"{weather_data.get('humidity', 0):.0f}% humidity",
                        'high'
                    )
                    results['high_risk_alerts'] += 1

                elif risk_factors.get('fungal_risk', 0) >= 70:
                    _create_weather_alert(
                        db, farm.id,
                        f"High fungal disease risk ({risk_factors['fungal_risk']:.0f}%). "
                        f"Monitor crops closely.",
                        'moderate'
                    )
                    results['high_risk_alerts'] += 1

                logger.info(f"Weather data stored for farm {farm.id}: "
                           f"temp={weather_data.get('temperature', 0):.1f}°C, "
                           f"humidity={weather_data.get('humidity', 0):.0f}%")

            except Exception as e:
                results['errors'] += 1
                logger.error(f"Failed to fetch weather for farm {farm.id}: {e}")

        db.commit()
        logger.info(f"Weather fetch complete: {results}")
        return results

    except Exception as e:
        logger.error(f"Error in fetch_all_farms_weather: {e}")
        raise
    finally:
        db.close()


@shared_task(name="weather.fetch_weather_forecast")
def fetch_weather_forecast():
    """
    Fetch 7-day weather forecast for all farms
    Used for disease prediction and planning
    Scheduled to run daily at midnight

    Returns:
        Dict with forecast summary
    """
    db = SessionLocal()
    try:
        weather_service = WeatherDataIntegrator()

        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None),
            Farm.longitude.isnot(None)
        ).all()

        logger.info(f"Fetching 7-day forecast for {len(farms)} farms")

        results = {
            'farms_processed': 0,
            'high_risk_days_detected': 0,
            'errors': 0
        }

        for farm in farms:
            try:
                # Fetch 7-day forecast
                forecast = weather_service.get_forecast(
                    lat=farm.latitude,
                    lon=farm.longitude,
                    days=7
                )

                if 'error' not in forecast:
                    results['farms_processed'] += 1

                    # Analyze forecast for disease risk days
                    daily = forecast.get('daily', {})
                    precip_probs = daily.get('precipitation_probability_max', [])
                    temps_max = daily.get('temperature_2m_max', [])

                    # Count high-risk days (high precip + warm temps)
                    for i in range(len(precip_probs)):
                        precip = precip_probs[i] if i < len(precip_probs) else 0
                        temp = temps_max[i] if i < len(temps_max) else 20

                        if precip > 70 and 15 <= temp <= 28:
                            results['high_risk_days_detected'] += 1

                    logger.debug(f"Forecast fetched for farm {farm.id}")
                else:
                    results['errors'] += 1

            except Exception as e:
                results['errors'] += 1
                logger.error(f"Failed to fetch forecast for farm {farm.id}: {e}")

        logger.info(f"Forecast fetch complete: {results}")
        return results

    except Exception as e:
        logger.error(f"Error in fetch_weather_forecast: {e}")
        raise
    finally:
        db.close()


@shared_task(name="weather.fetch_historical_weather")
def fetch_historical_weather(days_back: int = 7):
    """
    Fetch historical weather data for trend analysis
    Useful for filling gaps and initial data population

    Args:
        days_back: Number of days to fetch (default: 7)

    Returns:
        Dict with fetch results
    """
    db = SessionLocal()
    try:
        weather_service = WeatherDataIntegrator()

        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None),
            Farm.longitude.isnot(None)
        ).all()

        logger.info(f"Fetching {days_back} days historical weather for {len(farms)} farms")

        results = {
            'farms_processed': 0,
            'records_created': 0,
            'records_skipped': 0,
            'errors': 0
        }

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)

        for farm in farms:
            try:
                # Check existing records to avoid duplicates
                existing_dates = set(
                    r.date for r in db.query(WeatherRecord.date).filter(
                        WeatherRecord.region.contains(f"Lat:{farm.latitude:.2f}")
                    ).all()
                )

                # Fetch day by day
                current_date = start_date
                while current_date <= end_date:
                    if current_date.date() not in existing_dates:
                        weather_data = weather_service.integrate_multi_source_data(
                            lat=farm.latitude,
                            lon=farm.longitude,
                            start_date=current_date - timedelta(days=1),
                            end_date=current_date
                        )

                        risk_factors = weather_service.calculate_disease_risk_factors(weather_data)
                        weather_data['disease_risk_factors'] = risk_factors

                        store_weather_data(
                            db=db,
                            weather_data=weather_data,
                            lat=farm.latitude,
                            lon=farm.longitude,
                            date=current_date
                        )
                        results['records_created'] += 1
                    else:
                        results['records_skipped'] += 1

                    current_date += timedelta(days=1)

                results['farms_processed'] += 1

            except Exception as e:
                results['errors'] += 1
                logger.error(f"Failed to fetch historical weather for farm {farm.id}: {e}")

        db.commit()
        logger.info(f"Historical weather fetch complete: {results}")
        return results

    except Exception as e:
        logger.error(f"Error in fetch_historical_weather: {e}")
        raise
    finally:
        db.close()


@shared_task(name="weather.check_extreme_conditions")
def check_extreme_conditions():
    """
    Check for extreme weather conditions that require immediate alerts
    Scheduled to run every 3 hours

    Monitors for:
    - Heat waves (>35°C)
    - Frost risk (<5°C)
    - Heavy rainfall (>50mm/day)
    - Drought conditions (no rain for 14+ days)

    Returns:
        Dict with alert counts
    """
    db = SessionLocal()
    try:
        weather_service = WeatherDataIntegrator()

        farms = db.query(Farm).filter(
            Farm.latitude.isnot(None),
            Farm.longitude.isnot(None)
        ).all()

        logger.info(f"Checking extreme conditions for {len(farms)} farms")

        results = {
            'farms_checked': 0,
            'heat_alerts': 0,
            'frost_alerts': 0,
            'heavy_rain_alerts': 0,
            'drought_alerts': 0
        }

        today = datetime.now()

        for farm in farms:
            try:
                # Get current conditions
                weather_data = weather_service.integrate_multi_source_data(
                    lat=farm.latitude,
                    lon=farm.longitude,
                    start_date=today - timedelta(hours=6),
                    end_date=today
                )

                temp = weather_data.get('temperature', 20)
                rainfall = weather_data.get('rainfall', 0)

                results['farms_checked'] += 1

                # Check for heat wave
                if temp >= 35:
                    _create_weather_alert(
                        db, farm.id,
                        f"HEAT WARNING: Temperature {temp:.1f}°C. "
                        f"Provide shade and irrigation for crops.",
                        'severe'
                    )
                    results['heat_alerts'] += 1

                # Check for frost risk
                elif temp <= 5:
                    _create_weather_alert(
                        db, farm.id,
                        f"FROST WARNING: Temperature {temp:.1f}°C. "
                        f"Protect sensitive crops.",
                        'severe'
                    )
                    results['frost_alerts'] += 1

                # Check for heavy rainfall
                if rainfall >= 50:
                    _create_weather_alert(
                        db, farm.id,
                        f"HEAVY RAIN ALERT: {rainfall:.1f}mm precipitation. "
                        f"Risk of waterlogging and disease spread.",
                        'high'
                    )
                    results['heavy_rain_alerts'] += 1

                # Check for drought (14 days no significant rain)
                recent_weather = db.query(func.sum(WeatherRecord.rainfall)).filter(
                    WeatherRecord.region.contains(f"Lat:{farm.latitude:.2f}"),
                    WeatherRecord.date >= (today - timedelta(days=14)).date()
                ).scalar()

                if recent_weather is not None and recent_weather < 5:
                    _create_weather_alert(
                        db, farm.id,
                        f"DROUGHT WARNING: Only {recent_weather:.1f}mm rain in last 14 days. "
                        f"Consider irrigation.",
                        'high'
                    )
                    results['drought_alerts'] += 1

            except Exception as e:
                logger.error(f"Failed to check extreme conditions for farm {farm.id}: {e}")

        db.commit()
        logger.info(f"Extreme conditions check complete: {results}")
        return results

    except Exception as e:
        logger.error(f"Error in check_extreme_conditions: {e}")
        raise
    finally:
        db.close()


def _create_weather_alert(db, farm_id: int, message: str, level: str):
    """Helper to create weather-related alerts"""
    try:
        # Prefix message with [WEATHER] to identify alert type
        alert = Alert(
            farm_id=farm_id,
            message=f"[WEATHER] {message}",
            level=level
        )
        db.add(alert)
        logger.info(f"Weather alert created for farm {farm_id}: {level}")
    except Exception as e:
        logger.error(f"Failed to create alert for farm {farm_id}: {e}")
