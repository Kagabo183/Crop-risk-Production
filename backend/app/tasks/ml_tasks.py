"""
Machine Learning Celery Tasks
Background tasks for model training, batch inference, and periodic analysis
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

from celery import shared_task
from sqlalchemy import func

from app.db.database import SessionLocal
from app.models.farm import Farm
from app.models.data import SatelliteImage, WeatherRecord
from app.models.alert import Alert
from app.core.alert_messages import AlertMessageTemplates

logger = logging.getLogger(__name__)


# ============ Training Tasks ============

@shared_task(name='ml.train_anomaly_detector')
def train_anomaly_detector_task(days_back: int = 90) -> Dict[str, Any]:
    """
    Train the NDVI anomaly detection model on historical data.

    Args:
        days_back: Number of days of historical data to use

    Returns:
        Training metrics
    """
    db = SessionLocal()
    try:
        from app.ml import NDVIAnomalyDetector

        logger.info(f"Starting anomaly detector training with {days_back} days of data")

        # Fetch historical satellite data
        cutoff_date = datetime.utcnow() - timedelta(days=days_back)

        satellite_data = db.query(SatelliteImage).filter(
            SatelliteImage.date >= cutoff_date
        ).order_by(SatelliteImage.date).all()

        if len(satellite_data) < 20:
            logger.warning("Insufficient data for training")
            return {'error': 'Insufficient data', 'samples': len(satellite_data)}

        # Prepare training data
        training_data = []
        for record in satellite_data:
            training_data.append({
                'date': record.date,
                'ndvi': record.ndvi or 0.5,
                'ndwi': getattr(record, 'ndwi', 0.3),
                'evi': getattr(record, 'evi', 0.4),
                'farm_id': record.farm_id
            })

        # Train model
        detector = NDVIAnomalyDetector()
        metrics = detector.fit(training_data)

        # Save model
        if 'error' not in metrics:
            save_path = detector.save()
            metrics['model_path'] = save_path

        logger.info(f"Anomaly detector training complete: {metrics}")
        return metrics

    except Exception as e:
        logger.error(f"Anomaly detector training failed: {e}")
        return {'error': str(e)}
    finally:
        db.close()


@shared_task(name='ml.train_yield_predictor')
def train_yield_predictor_task(crop_type: str = 'potato') -> Dict[str, Any]:
    """
    Train the yield prediction model.

    Note: Requires historical yield data which may not be available initially.
    Uses synthetic training data if actual data is unavailable.

    Args:
        crop_type: Type of crop for the model

    Returns:
        Training metrics
    """
    db = SessionLocal()
    try:
        from app.ml import YieldPredictor
        import numpy as np

        logger.info(f"Starting yield predictor training for {crop_type}")

        # Get farms with this crop type
        farms = db.query(Farm).filter(Farm.crop_type == crop_type).all()

        if not farms:
            farms = db.query(Farm).limit(10).all()

        training_data = []

        for farm in farms:
            # Get satellite and weather data
            satellite = db.query(SatelliteImage).filter(
                SatelliteImage.farm_id == farm.id
            ).order_by(SatelliteImage.date.desc()).limit(30).all()

            weather = db.query(WeatherRecord).filter(
                WeatherRecord.farm_id == farm.id
            ).order_by(WeatherRecord.date.desc()).limit(30).all()

            if not satellite or not weather:
                continue

            # Compute features
            ndvi_values = [s.ndvi for s in satellite if s.ndvi]
            temps = [w.temperature for w in weather if w.temperature]
            rainfall = [w.rainfall for w in weather if w.rainfall]

            # Generate synthetic yield (in production, use actual yield data)
            # Yield correlates with NDVI: higher NDVI = higher yield
            avg_ndvi = np.mean(ndvi_values) if ndvi_values else 0.5
            synthetic_yield = 10 + avg_ndvi * 15 + np.random.normal(0, 2)

            training_data.append({
                'vegetation': {
                    'ndvi_mean': avg_ndvi,
                    'ndvi_max': max(ndvi_values) if ndvi_values else 0.6,
                    'ndvi_trend': 0.0,
                    'health_score': avg_ndvi * 100
                },
                'weather': {
                    'temp_mean': np.mean(temps) if temps else 20,
                    'temp_max': max(temps) if temps else 25,
                    'temp_min': min(temps) if temps else 15,
                    'rainfall_total': sum(rainfall) if rainfall else 100,
                    'rainfall_days': len([r for r in rainfall if r > 0]) if rainfall else 10,
                    'humidity_mean': 70
                },
                'farm': {'area': farm.area or 1.0, 'elevation': 1500},
                'growing_season_days': 90,
                'historical': {'yield_mean': 12, 'yield_trend': 0},
                'actual_yield': max(1, synthetic_yield)
            })

        if len(training_data) < 10:
            logger.warning("Insufficient training data")
            return {'error': 'Insufficient data', 'samples': len(training_data)}

        # Train model
        predictor = YieldPredictor(crop_type=crop_type)
        metrics = predictor.train(training_data)

        # Save model
        if 'error' not in metrics:
            save_path = predictor.save()
            metrics['model_path'] = save_path

        logger.info(f"Yield predictor training complete: {metrics}")
        return metrics

    except Exception as e:
        logger.error(f"Yield predictor training failed: {e}")
        return {'error': str(e)}
    finally:
        db.close()


@shared_task(name='ml.train_health_forecaster')
def train_health_forecaster_task(farm_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Train the health trend forecaster.

    Args:
        farm_id: Specific farm to train for, or None for all farms

    Returns:
        Training metrics
    """
    db = SessionLocal()
    try:
        from app.ml import HealthTrendForecaster

        logger.info(f"Starting health forecaster training")

        # Get historical data
        query = db.query(SatelliteImage).order_by(SatelliteImage.date)
        if farm_id:
            query = query.filter(SatelliteImage.farm_id == farm_id)

        satellite_data = query.all()

        if len(satellite_data) < 30:
            logger.warning("Insufficient data for forecaster training")
            return {'error': 'Insufficient data', 'samples': len(satellite_data)}

        # Prepare training data
        historical_data = []
        for record in satellite_data:
            historical_data.append({
                'date': record.date,
                'health_score': (record.ndvi or 0.5) * 100,
                'ndvi': record.ndvi or 0.5
            })

        # Train model
        forecaster = HealthTrendForecaster()
        metrics = forecaster.train(historical_data)

        # Save model
        if 'error' not in metrics:
            save_path = forecaster.save()
            metrics['model_path'] = save_path

        logger.info(f"Health forecaster training complete: {metrics}")
        return metrics

    except Exception as e:
        logger.error(f"Health forecaster training failed: {e}")
        return {'error': str(e)}
    finally:
        db.close()


# ============ Inference Tasks ============

@shared_task(name='ml.batch_risk_assessment')
def batch_risk_assessment_task() -> Dict[str, Any]:
    """
    Run risk assessment for all farms and generate alerts.

    Returns:
        Summary of risk assessments
    """
    db = SessionLocal()
    try:
        from app.ml import EnsembleRiskScorer

        logger.info("Starting batch risk assessment")

        farms = db.query(Farm).all()

        if not farms:
            return {'error': 'No farms found'}

        scorer = EnsembleRiskScorer()
        results = []
        high_risk_farms = []

        for farm in farms:
            try:
                # Build farm data
                satellite = db.query(SatelliteImage).filter(
                    SatelliteImage.farm_id == farm.id
                ).order_by(SatelliteImage.date.desc()).limit(30).all()

                weather = db.query(WeatherRecord).filter(
                    WeatherRecord.farm_id == farm.id
                ).order_by(WeatherRecord.date.desc()).limit(30).all()

                ndvi_values = [s.ndvi for s in satellite if s.ndvi]
                temps = [w.temperature for w in weather if w.temperature]
                rainfall = [w.rainfall for w in weather if w.rainfall]

                farm_data = {
                    'farm': {
                        'id': farm.id,
                        'name': farm.name,
                        'area': farm.area or 1.0
                    },
                    'vegetation': {
                        'ndvi': ndvi_values[0] if ndvi_values else 0.5,
                        'ndvi_mean': sum(ndvi_values) / len(ndvi_values) if ndvi_values else 0.5,
                        'historical_ndvi_mean': 0.6
                    },
                    'weather': {
                        'temperature': temps[0] if temps else 20,
                        'rainfall': sum(rainfall[:7]) if rainfall else 0,
                        'rainfall_7d': sum(rainfall[:7]) if rainfall else 0,
                        'humidity': 70,
                        'leaf_wetness_hours': 8
                    },
                    'crop_type': farm.crop_type or 'potato'
                }

                result = scorer.calculate_risk(farm_data)
                results.append(result)

                # Create alert for high/critical risk
                if result['risk_level'] in ['high', 'critical']:
                    high_risk_farms.append(farm.id)

                    # Get role-based messages
                    farmer_msg, action, days = AlertMessageTemplates.get_ml_risk_message(
                        result['risk_level'],
                        result['overall_risk_score'],
                        result['primary_driver'],
                        is_farmer=True
                    )
                    tech_msg, _, _ = AlertMessageTemplates.get_ml_risk_message(
                        result['risk_level'],
                        result['overall_risk_score'],
                        result['primary_driver'],
                        is_farmer=False
                    )

                    alert = Alert(
                        farm_id=farm.id,
                        message=farmer_msg,  # Default to farmer-friendly
                        level=result['risk_level'],
                        alert_type='risk_assessment',
                        source='ml_model',
                        severity=result['risk_level'],
                        action_days_min=days[0] if days else None,
                        action_days_max=days[1] if days else None,
                        alert_data={
                            'message_farmer': farmer_msg,
                            'message_technical': tech_msg,
                            'action': action,
                            'risk_score': result['overall_risk_score'],
                            'primary_driver': result['primary_driver'],
                            'risk_factors': result.get('risk_factors')
                        }
                    )
                    db.add(alert)

            except Exception as e:
                logger.error(f"Risk assessment failed for farm {farm.id}: {e}")

        db.commit()

        # Summary
        summary = scorer.get_regional_summary(results)
        summary['high_risk_farms'] = high_risk_farms
        summary['alerts_created'] = len(high_risk_farms)

        logger.info(f"Batch risk assessment complete: {len(results)} farms assessed")
        return summary

    except Exception as e:
        logger.error(f"Batch risk assessment failed: {e}")
        db.rollback()
        return {'error': str(e)}
    finally:
        db.close()


@shared_task(name='ml.detect_anomalies_all_farms')
def detect_anomalies_all_farms_task() -> Dict[str, Any]:
    """
    Run anomaly detection for all farms.

    Returns:
        Summary of anomalies detected
    """
    db = SessionLocal()
    try:
        from app.ml import NDVIAnomalyDetector

        logger.info("Starting anomaly detection for all farms")

        detector = NDVIAnomalyDetector()

        farms = db.query(Farm).all()
        total_anomalies = 0
        farm_anomalies = {}

        for farm in farms:
            # Get recent satellite data
            satellite_data = db.query(SatelliteImage).filter(
                SatelliteImage.farm_id == farm.id
            ).order_by(SatelliteImage.date.desc()).limit(30).all()

            if not satellite_data:
                continue

            veg_data = [{
                'date': s.date,
                'ndvi': s.ndvi or 0.5,
                'ndwi': getattr(s, 'ndwi', 0.3),
                'evi': getattr(s, 'evi', 0.4),
                'farm_id': farm.id
            } for s in satellite_data]

            results = detector.detect(veg_data)
            anomalies = [r for r in results if r.get('is_anomaly')]

            if anomalies:
                total_anomalies += len(anomalies)
                farm_anomalies[farm.id] = len(anomalies)

                # Create alert for significant anomalies
                if anomalies[0].get('severity') in ['severe', 'critical']:
                    anom_days = (1, 3) if anomalies[0].get('severity') == 'critical' else (2, 5)
                    severity = anomalies[0].get('severity', 'severe')
                    anom_type = anomalies[0].get('anomaly_type', 'Unknown').lower()

                    # Create farmer-friendly and technical messages
                    if severity == 'critical':
                        farmer_msg = f"⚠️ URGENT: AI detected unusual {anom_type}. Check your crops immediately!"
                        tech_msg = f"[ML ANOMALY] Critical {anom_type} detected. Immediate inspection required."
                        action = "Inspect crops within 1-3 days, investigate cause"
                    else:  # severe
                        farmer_msg = f"⚠️ Warning: AI found unusual {anom_type}. Check your farm soon."
                        tech_msg = f"[ML ANOMALY] Severe {anom_type} detected. Investigation recommended."
                        action = "Inspect affected area within 2-5 days"

                    alert = Alert(
                        farm_id=farm.id,
                        message=farmer_msg,  # Default to farmer-friendly
                        level='high',
                        alert_type='anomaly_detection',
                        source='ml_model',
                        severity=severity,
                        action_days_min=anom_days[0],
                        action_days_max=anom_days[1],
                        alert_data={
                            'message_farmer': farmer_msg,
                            'message_technical': tech_msg,
                            'action': action,
                            'anomaly_type': anom_type,
                            'severity': severity,
                            'anomalies': anomalies
                        }
                    )
                    db.add(alert)

        db.commit()

        logger.info(f"Anomaly detection complete: {total_anomalies} anomalies in {len(farm_anomalies)} farms")

        return {
            'total_farms_analyzed': len(farms),
            'farms_with_anomalies': len(farm_anomalies),
            'total_anomalies': total_anomalies,
            'farm_details': farm_anomalies
        }

    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}")
        db.rollback()
        return {'error': str(e)}
    finally:
        db.close()


@shared_task(name='ml.generate_health_forecasts')
def generate_health_forecasts_task(forecast_days: int = 7) -> Dict[str, Any]:
    """
    Generate health forecasts for all farms.

    Args:
        forecast_days: Number of days to forecast

    Returns:
        Summary of forecasts
    """
    db = SessionLocal()
    try:
        from app.ml import HealthTrendForecaster

        logger.info(f"Generating {forecast_days}-day health forecasts")

        forecaster = HealthTrendForecaster(forecast_days=forecast_days)

        farms = db.query(Farm).all()
        forecasts = {}
        alerts_created = 0

        for farm in farms:
            # Get historical data
            satellite_data = db.query(SatelliteImage).filter(
                SatelliteImage.farm_id == farm.id
            ).order_by(SatelliteImage.date).all()

            if len(satellite_data) < 14:
                continue

            historical_data = [{
                'date': s.date,
                'health_score': (s.ndvi or 0.5) * 100
            } for s in satellite_data]

            # Train on farm's data
            forecaster.train(historical_data)

            # Generate forecast
            forecast = forecaster.forecast(days=forecast_days)

            if 'error' not in forecast:
                forecasts[farm.id] = {
                    'trend': forecast.get('trend_direction'),
                    'average': forecast.get('average_forecast'),
                    'min': forecast.get('min_forecast'),
                    'alerts': len(forecast.get('alerts', []))
                }

                # Create alert for declining trends
                if forecast.get('trend_direction') == 'declining':
                    if forecast.get('min_forecast', 70) < 50:
                        min_forecast = forecast.get('min_forecast', 0)

                        # Create farmer-friendly and technical messages
                        farmer_msg = f"📉 Heads up: AI predicts your crop health may drop to {min_forecast:.0f}/100. Plan preventive action in 5-10 days."
                        tech_msg = f"[ML FORECAST] Declining health trend predicted. Minimum forecast: {min_forecast:.0f}/100. Preventive measures recommended."
                        action = "Monitor closely, prepare interventions (irrigation, fertilizer, etc.)"

                        alert = Alert(
                            farm_id=farm.id,
                            message=farmer_msg,  # Default to farmer-friendly
                            level='moderate',
                            alert_type='health_forecast',
                            source='ml_model',
                            severity='moderate',
                            action_days_min=5,
                            action_days_max=10,
                            alert_data={
                                'message_farmer': farmer_msg,
                                'message_technical': tech_msg,
                                'action': action,
                                'min_forecast': min_forecast,
                                'trend_direction': forecast.get('trend_direction'),
                                'forecast_days': forecast_days
                            }
                        )
                        db.add(alert)
                        alerts_created += 1

        db.commit()

        logger.info(f"Health forecasts generated for {len(forecasts)} farms")

        return {
            'farms_forecasted': len(forecasts),
            'forecast_days': forecast_days,
            'alerts_created': alerts_created,
            'forecasts': forecasts
        }

    except Exception as e:
        logger.error(f"Health forecast generation failed: {e}")
        db.rollback()
        return {'error': str(e)}
    finally:
        db.close()


# ============ Maintenance Tasks ============

@shared_task(name='ml.retrain_all_models')
def retrain_all_models_task() -> Dict[str, Any]:
    """
    Retrain all ML models with latest data.
    Should be run periodically (weekly/monthly).

    Returns:
        Training results for all models
    """
    logger.info("Starting full model retraining")

    results = {}

    # Train anomaly detector
    results['anomaly_detector'] = train_anomaly_detector_task(days_back=90)

    # Train yield predictor for each crop type
    for crop_type in ['potato', 'tomato', 'maize']:
        results[f'yield_predictor_{crop_type}'] = train_yield_predictor_task(crop_type=crop_type)

    # Train health forecaster
    results['health_forecaster'] = train_health_forecaster_task()

    logger.info(f"Model retraining complete: {results}")

    return results


@shared_task(name='ml.model_health_check')
def model_health_check_task() -> Dict[str, Any]:
    """
    Check health status of all ML models.

    Returns:
        Health status of models
    """
    try:
        from app.ml import get_registry

        registry = get_registry()
        health = registry.health_check()

        # Log issues
        if health.get('issues'):
            for issue in health['issues']:
                logger.warning(f"Model issue: {issue}")

        return health

    except Exception as e:
        logger.error(f"Model health check failed: {e}")
        return {'error': str(e)}
