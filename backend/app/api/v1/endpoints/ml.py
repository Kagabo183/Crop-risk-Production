"""
Machine Learning API Endpoints
Provides REST API access to ML models and predictions
"""
import os
import logging
from typing import List, Optional
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.farm import Farm
from app.core.auth import get_current_active_user, check_farm_access, require_any_authenticated
from app.models.user import User as UserModel

logger = logging.getLogger(__name__)

router = APIRouter()

# Temporary upload directory
UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', '/tmp/uploads'))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ============ Request/Response Models ============

class DiseaseClassifyRequest(BaseModel):
    """Request for disease classification"""
    image_url: Optional[str] = None
    crop_type: Optional[str] = Field(default=None, description="Optional crop filter (e.g. potato, tomato, rice, coffee, mango). If None, classifies across all 30 plants.")


class DiseaseClassifyResponse(BaseModel):
    """Response from disease classification"""
    plant: str
    disease: str
    confidence: float
    is_healthy: Optional[bool]
    top5: list
    treatment: dict
    crop_type: str
    gradcam_base64: Optional[str] = None
    model_type: Optional[str] = None  # "per_crop" or "general_80class"


class RiskAssessmentRequest(BaseModel):
    """Request for risk assessment"""
    farm_id: int
    include_forecast: bool = Field(default=True)
    forecast_days: int = Field(default=7, ge=1, le=30)


class RiskAssessmentResponse(BaseModel):
    """Response from risk assessment"""
    farm_id: int
    overall_risk_score: float
    risk_level: str
    confidence: float
    components: dict
    primary_driver: str
    recommendations: List[str]
    timestamp: str


class YieldPredictionRequest(BaseModel):
    """Request for yield prediction"""
    farm_id: int
    crop_type: Optional[str] = None


class YieldPredictionResponse(BaseModel):
    """Response from yield prediction"""
    farm_id: int
    predicted_yield_tons_ha: float
    lower_bound: float
    upper_bound: float
    confidence: float
    yield_class: str
    recommendations: List[str]


class AnomalyDetectionRequest(BaseModel):
    """Request for anomaly detection"""
    farm_id: int
    days_back: int = Field(default=30, ge=7, le=90)


class HealthForecastRequest(BaseModel):
    """Request for health trend forecast"""
    farm_id: int
    forecast_days: int = Field(default=14, ge=7, le=30)
    include_scenarios: bool = Field(default=False)


class ModelStatusResponse(BaseModel):
    """Response for model status"""
    overall: str
    models: dict
    timestamp: str


# ============ Helper Functions ============

def get_farm_data(farm_id: int, db: Session) -> dict:
    """
    Fetch farm data including vegetation, weather, and metadata.
    """
    # Get farm
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    # Get recent satellite data
    satellite_data = db.query(SatelliteImage).filter(
        SatelliteImage.farm_id == farm_id
    ).order_by(SatelliteImage.date.desc()).limit(30).all()

    # Get recent weather data
    weather_data = db.query(WeatherRecord).filter(
        WeatherRecord.farm_id == farm_id
    ).order_by(WeatherRecord.date.desc()).limit(30).all()

    # Compute vegetation statistics
    ndvi_values = [s.mean_ndvi for s in satellite_data if s.mean_ndvi is not None]
    vegetation = {
        'ndvi': ndvi_values[0] if ndvi_values else 0.5,
        'ndvi_mean': sum(ndvi_values) / len(ndvi_values) if ndvi_values else 0.5,
        'ndvi_max': max(ndvi_values) if ndvi_values else 0.6,
        'ndvi_trend': 0.0,  # Would compute from time series
        'historical_ndvi_mean': sum(ndvi_values) / len(ndvi_values) if ndvi_values else 0.6,
        'health_score': 70.0  # Default
    }

    # Compute weather statistics
    weather = {}
    if weather_data:
        temps = [w.temperature for w in weather_data if w.temperature is not None]
        rainfall = [w.rainfall for w in weather_data if w.rainfall is not None]

        weather = {
            'temperature': temps[0] if temps else 20.0,
            'temp_mean': sum(temps) / len(temps) if temps else 20.0,
            'temp_max': max(temps) if temps else 25.0,
            'temp_min': min(temps) if temps else 15.0,
            'rainfall': sum(rainfall[:7]) if rainfall else 0.0,  # Last 7 days
            'rainfall_7d': sum(rainfall[:7]) if rainfall else 0.0,
            'rainfall_total': sum(rainfall) if rainfall else 0.0,
            'humidity': weather_data[0].humidity if hasattr(weather_data[0], 'humidity') else 70.0,
            'leaf_wetness_hours': 8  # Default estimate
        }

    return {
        'farm': {
            'id': farm.id,
            'name': farm.name,
            'area': farm.area or 1.0,
            'latitude': farm.latitude,
            'longitude': farm.longitude,
            'elevation': 1500  # Default for Rwanda
        },
        'vegetation': vegetation,
        'weather': weather,
        'crop_type': farm.crop_type or 'potato',
        'growing_season_days': 90,
        'historical': {
            'yield_mean': 12.0,  # Default
            'yield_trend': 0.0
        }
    }


# ============ Disease Classification Endpoints ============

@router.post("/classify-disease", response_model=DiseaseClassifyResponse)
async def classify_disease(
    file: UploadFile = File(...),
    crop_type: Optional[str] = Query(
        default=None,
        description="Crop type. If a per-crop model exists (tomato, coffee, pepper, potato), "
                    "uses the specialized model. Otherwise falls back to the general 80-class model."
    ),
    current_user: UserModel = Depends(require_any_authenticated),
):
    """
    Classify plant disease from uploaded leaf image.

    When crop_type matches a Rwanda priority crop (tomato, coffee, pepper, potato)
    and its per-crop model is trained, uses the specialized model for higher accuracy.
    Otherwise falls back to the general 80-class model.
    """
    # Save uploaded file
    file_path = UPLOAD_DIR / f"disease_{datetime.utcnow().timestamp()}_{file.filename}"
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    try:
        result = None
        model_type_used = "general_80class"

        # Try per-crop model first
        if crop_type:
            from app.ml.crop_disease_config import get_crop_config
            crop_config = get_crop_config(crop_type)

            if crop_config:
                from app.ml.crop_disease_classifier import CropDiseaseClassifier
                classifier = CropDiseaseClassifier(config=crop_config)
                if classifier.load_model():
                    result = classifier.predict_with_gradcam(str(file_path))
                    model_type_used = "per_crop"
                    logger.info(f"Used per-crop model for {crop_type}")
                else:
                    logger.info(f"Per-crop model for {crop_type} not available, falling back to general")

        # Fallback to general 80-class model
        if result is None:
            from app.ml import DiseaseClassifier
            classifier = DiseaseClassifier(crop_type=crop_type)
            result = classifier.predict_with_gradcam(str(file_path))

        return DiseaseClassifyResponse(
            plant=result.get('plant', 'Unknown'),
            disease=result['disease'],
            confidence=result['confidence'],
            is_healthy=result.get('is_healthy'),
            top5=result.get('top5', []),
            treatment=result.get('treatment', {}),
            crop_type=result.get('crop_type', crop_type or 'unknown'),
            gradcam_base64=result.get('gradcam_base64'),
            model_type=model_type_used,
        )

    except Exception as e:
        logger.error(f"Disease classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        file_path.unlink(missing_ok=True)


@router.get("/supported-diseases")
async def get_supported_diseases():
    """
    Get list of all supported plants and diseases (80 classes).
    """
    from app.ml.disease_classifier import PLANT_DISEASES, TREATMENT_RECOMMENDATIONS, NUM_CLASSES

    return {
        "total_classes": NUM_CLASSES,
        "total_plants": len(PLANT_DISEASES),
        "plants": sorted(PLANT_DISEASES.keys()),
        "diseases_by_plant": {
            plant: sorted(set(diseases))
            for plant, diseases in PLANT_DISEASES.items()
        },
        "treatments_available": sorted(TREATMENT_RECOMMENDATIONS.keys())
    }


@router.get("/crop-models")
async def list_crop_models():
    """
    List available per-crop disease classification models.

    Returns Rwanda priority crops with their class counts and model availability.
    """
    from app.ml.crop_disease_config import CROP_DISEASE_CONFIGS
    from app.ml.disease_classifier import CLASS_INFO

    models = []
    for key, config in CROP_DISEASE_CONFIGS.items():
        model_path = Path(os.environ.get('MODEL_DIR', '/app/data/models')) / config.model_filename

        # Build disease list from CLASS_INFO
        diseases = []
        for class_name in sorted(config.class_names):
            info = CLASS_INFO.get(class_name, ("Unknown", "Unknown", False))
            diseases.append({
                "class_name": class_name,
                "plant": info[0],
                "disease": info[1],
                "is_healthy": info[2],
            })

        models.append({
            "crop_key": config.crop_key,
            "display_name": config.display_name,
            "num_classes": config.num_classes,
            "diseases": diseases,
            "rwanda_priority": config.rwanda_priority,
            "model_available": model_path.exists(),
            "description": config.description,
        })

    return {
        "crop_models": models,
        "total": len(models),
    }


@router.post("/evaluate-model")
async def evaluate_model(
    data_dir: str = Query(..., description="Path to evaluation dataset (ImageFolder format)"),
    crop_type: Optional[str] = Query(default=None, description="Crop type for per-crop model, or None for general model"),
    batch_size: int = Query(default=32, ge=1, le=128),
    current_user: UserModel = Depends(require_any_authenticated),
):
    """
    Evaluate a disease classification model on a dataset.

    Returns precision, recall, F1 (per-class and overall), confusion matrix,
    and a full classification report.
    """
    try:
        if crop_type:
            from app.ml.crop_disease_config import get_crop_config
            crop_config = get_crop_config(crop_type)

            if crop_config:
                from app.ml.crop_disease_classifier import CropDiseaseClassifier
                classifier = CropDiseaseClassifier(config=crop_config)
                if not classifier.load_model():
                    raise HTTPException(
                        status_code=404,
                        detail=f"Per-crop model for {crop_type} not found. Train it first."
                    )
                result = classifier.evaluate(data_dir, batch_size=batch_size)
            else:
                # Unknown crop — use general model
                from app.ml import DiseaseClassifier
                classifier = DiseaseClassifier(crop_type=crop_type)
                if not classifier.load_model():
                    raise HTTPException(status_code=404, detail="General model not found")
                result = classifier.evaluate(data_dir, batch_size=batch_size)
        else:
            from app.ml import DiseaseClassifier
            classifier = DiseaseClassifier()
            if not classifier.load_model():
                raise HTTPException(status_code=404, detail="General model not found")
            result = classifier.evaluate(data_dir, batch_size=batch_size)

        if 'error' in result:
            raise HTTPException(status_code=500, detail=result['error'])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Model evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Risk Assessment Endpoints ============

@router.post("/risk-assessment", response_model=RiskAssessmentResponse)
async def calculate_risk_assessment(
    request: RiskAssessmentRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Calculate comprehensive risk assessment for a farm.

    Combines:
    - Research-validated disease models (Smith Period, TOM-CAST)
    - ML anomaly detection
    - Weather stress analysis
    - Yield prediction
    - Health trend forecast
    """
    try:
        from app.ml import EnsembleRiskScorer

        # Get farm data
        # Check access before processing
        farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        farm_data = get_farm_data(request.farm_id, db)

        # Calculate risk
        scorer = EnsembleRiskScorer()
        result = scorer.calculate_risk(farm_data)

        return RiskAssessmentResponse(
            farm_id=request.farm_id,
            overall_risk_score=result['overall_risk_score'],
            risk_level=result['risk_level'],
            confidence=result['confidence'],
            components=result['components'],
            primary_driver=result['primary_driver'],
            recommendations=result['recommendations'],
            timestamp=result['timestamp']
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk assessment failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/risk-assessment/{farm_id}")
async def get_risk_assessment(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get risk assessment for a farm (shortcut GET endpoint).
    """
    try:
        from app.ml import EnsembleRiskScorer
        
        # Check access
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        farm_data = get_farm_data(farm_id, db)
        scorer = EnsembleRiskScorer()
        result = scorer.calculate_risk(farm_data)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk assessment failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/risk-assessment/batch")
async def batch_risk_assessment(
    farm_ids: List[int] = Query(...),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Calculate risk assessment for multiple farms.
    """
    try:
        from app.ml import EnsembleRiskScorer

        from app.ml import EnsembleRiskScorer
        
        # Filter farm_ids based on access
        accessible_farms = []
        for fid in farm_ids:
            farm = db.query(Farm).filter(Farm.id == fid).first()
            if farm:
                try:
                    if check_farm_access(farm, current_user):
                        accessible_farms.append(fid)
                except HTTPException:
                    pass
        
        if not accessible_farms:
             return {"assessments": [], "summary": {}}

        farms_data = [get_farm_data(fid, db) for fid in accessible_farms]
        scorer = EnsembleRiskScorer()

        results = scorer.batch_calculate(farms_data)
        summary = scorer.get_regional_summary(results)

        return {
            "assessments": results,
            "summary": summary
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Batch risk assessment failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Yield Prediction Endpoints ============

@router.post("/predict-yield", response_model=YieldPredictionResponse)
async def predict_yield(
    request: YieldPredictionRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Predict crop yield for a farm based on current conditions.
    """
    try:
        from app.ml import YieldPredictor

        farm_data = get_farm_data(request.farm_id, db)
        
        # Check access (get_farm_data fetches farm but doesn't check owner)
        # We need to fetch farm object separately to check owner/district
        farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
        check_farm_access(farm, current_user)

        crop_type = request.crop_type or farm_data.get('crop_type', 'potato')
        predictor = YieldPredictor(crop_type=crop_type)
        result = predictor.predict(farm_data)

        return YieldPredictionResponse(
            farm_id=request.farm_id,
            predicted_yield_tons_ha=result['predicted_yield_tons_ha'],
            lower_bound=result['lower_bound'],
            upper_bound=result['upper_bound'],
            confidence=result['confidence'],
            yield_class=result['yield_class'],
            recommendations=result.get('recommendations', [])
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Yield prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/predict-yield/{farm_id}")
async def get_yield_prediction(
    farm_id: int,
    crop_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get yield prediction for a farm (shortcut GET endpoint).
    """
    try:
        from app.ml import YieldPredictor
        
        # Check access
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        farm_data = get_farm_data(farm_id, db)
        crop_type = crop_type or farm_data.get('crop_type', 'potato')

        predictor = YieldPredictor(crop_type=crop_type)
        result = predictor.predict(farm_data)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Yield prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Anomaly Detection Endpoints ============

@router.post("/detect-anomalies")
async def detect_anomalies(
    request: AnomalyDetectionRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Detect vegetation anomalies for a farm.
    """
    try:
        from app.ml import NDVIAnomalyDetector

        # Get satellite data
        # Check access first
        farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        satellite_data = db.query(SatelliteImage).filter(
            SatelliteImage.farm_id == request.farm_id
        ).order_by(SatelliteImage.date.desc()).limit(request.days_back).all()

        if not satellite_data:
            raise HTTPException(status_code=404, detail="No satellite data found for farm")

        # Prepare data
        veg_data = []
        for record in satellite_data:
            veg_data.append({
                'date': record.date,
                'ndvi': record.mean_ndvi or 0.5,
                'ndwi': record.mean_ndwi if record.mean_ndwi is not None else 0.3,
                'evi': record.mean_evi if record.mean_evi is not None else 0.4,
                'farm_id': request.farm_id
            })

        # Detect anomalies
        detector = NDVIAnomalyDetector()
        results = detector.detect(veg_data)

        # Summary
        anomalies = [r for r in results if r.get('is_anomaly')]

        return {
            "farm_id": request.farm_id,
            "total_records": len(results),
            "anomalies_detected": len(anomalies),
            "anomaly_rate": len(anomalies) / len(results) if results else 0,
            "results": results,
            "anomalies": anomalies
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Anomaly detection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Health Forecast Endpoints ============

@router.post("/forecast-health")
async def forecast_health(
    request: HealthForecastRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Forecast vegetation health trends for a farm.
    """
    try:
        from app.ml import HealthTrendForecaster

        # Get historical data for training
        
        # Check access
        farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        satellite_data = db.query(SatelliteImage).filter(
            SatelliteImage.farm_id == request.farm_id
        ).order_by(SatelliteImage.date).all()

        if len(satellite_data) < 14:
            raise HTTPException(
                status_code=400,
                detail="Insufficient data for forecasting (need at least 14 days)"
            )

        # Prepare training data
        historical_data = []
        for record in satellite_data:
            historical_data.append({
                'date': record.date,
                'health_score': (record.mean_ndvi or 0.5) * 100,
                'ndvi': record.mean_ndvi or 0.5
            })

        # Train and forecast
        forecaster = HealthTrendForecaster(forecast_days=request.forecast_days)

        # Train on historical data
        train_result = forecaster.train(historical_data)
        if 'error' in train_result:
            logger.warning(f"Training issue: {train_result['error']}")

        # Generate forecast
        forecast = forecaster.forecast(days=request.forecast_days)

        # Add scenarios if requested
        if request.include_scenarios:
            forecast = forecaster.forecast_with_scenarios(
                forecast,
                scenarios=['drought', 'normal', 'wet']
            )

        return {
            "farm_id": request.farm_id,
            "forecast": forecast,
            "training_info": train_result
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Health forecast failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Model Management Endpoints ============

@router.get("/models/status", response_model=ModelStatusResponse)
async def get_model_status():
    """
    Get status of all ML models.
    """
    try:
        from app.ml import get_registry

        registry = get_registry()
        health = registry.health_check()

        return ModelStatusResponse(
            overall=health['overall'],
            models=health['models'],
            timestamp=health['timestamp']
        )

    except Exception as e:
        logger.error(f"Model status check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models/list")
async def list_models():
    """
    List all available ML models.
    """
    try:
        from app.ml import get_registry

        registry = get_registry()

        return {
            "available_models": registry.list_available_models(),
            "saved_models": registry.list_saved_models(),
            "metrics": registry.get_metrics()
        }

    except Exception as e:
        logger.error(f"Model listing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/models/load-all")
async def load_all_models():
    """
    Load all ML models into memory.
    """
    try:
        from app.ml import get_registry

        registry = get_registry()
        results = registry.load_all_models()

        return {
            "loaded": results,
            "health": registry.health_check()
        }

    except Exception as e:
        logger.error(f"Model loading failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Intelligence Endpoints ============

@router.get("/explain-risk/{farm_id}")
async def explain_risk(
    farm_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """
    Get detailed explanation of risk factors for a farm.
    """
    try:
        from app.ml import EnsembleRiskScorer, RiskIntelligence
        
        # Check access
        farm = db.query(Farm).filter(Farm.id == farm_id).first()
        if not farm:
            raise HTTPException(status_code=404, detail="Farm not found")
        check_farm_access(farm, current_user)

        farm_data = get_farm_data(farm_id, db)

        # Calculate risk
        scorer = EnsembleRiskScorer()
        risk_result = scorer.calculate_risk(farm_data)

        # Get intelligence analysis
        features = {
            'ndvi_trend': farm_data['vegetation'].get('ndvi_trend', 0),
            'ndvi_anomaly': farm_data['vegetation'].get('ndvi', 0.5) - 0.6,
            'rainfall_deficit': 30 - farm_data['weather'].get('rainfall_7d', 30),
            'heat_stress_days': 0  # Would calculate from temp data
        }

        contributions = RiskIntelligence.calculate_feature_importance(
            features, risk_result['overall_risk_score']
        )
        top_drivers = RiskIntelligence.get_top_risk_drivers(contributions)
        explanation = RiskIntelligence.explain_risk_drivers(
            top_drivers, risk_result['overall_risk_score']
        )
        time_to_impact = RiskIntelligence.calculate_time_to_impact(
            risk_result['overall_risk_score'],
            features['ndvi_trend']
        )
        recommendations = RiskIntelligence.generate_recommendations(
            risk_result['overall_risk_score'],
            top_drivers,
            time_to_impact
        )

        return {
            "farm_id": farm_id,
            "risk_score": risk_result['overall_risk_score'],
            "risk_level": risk_result['risk_level'],
            "explanation": explanation,
            "contributions": contributions,
            "top_drivers": [{"factor": d[0], "contribution": d[1]} for d in top_drivers],
            "time_to_impact": time_to_impact,
            "recommendations": recommendations,
            "scenarios": {
                "irrigation": RiskIntelligence.simulate_scenario(
                    risk_result['overall_risk_score'], 20, 'irrigation'
                ),
                "no_action": {
                    "new_risk": risk_result['overall_risk_score'],
                    "description": "Current trajectory"
                }
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk explanation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
