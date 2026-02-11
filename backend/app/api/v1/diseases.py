"""
API endpoints for disease predictions and forecasts
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta

from app.db.database import get_db
from app.models.farm import Farm
from app.models.disease import Disease, DiseasePrediction, DiseaseObservation
from app.schemas.disease import (
    DiseasePredictionRequest,
    DiseasePredictionResponse,
    DiseasePrediction as DiseasePredictionSchema,
    Disease as DiseaseSchema,
    DiseaseCreate,
    DiseaseObservationCreate,
    DiseaseObservation as DiseaseObservationSchema,
    DailyForecast,
    WeeklyForecastSummary
)
from app.services.disease_intelligence import DiseaseModelEngine, ShortTermForecastEngine
from app.services.weather_service import WeatherDataIntegrator
from app.core.config import Settings

router = APIRouter(tags=["diseases"])
settings = Settings()


@router.get("/", response_model=List[DiseaseSchema])
def list_diseases(
    skip: int = 0,
    limit: int = 100,
    pathogen_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    List all diseases in the database
    Filter by pathogen type if specified
    """
    query = db.query(Disease)
    
    if pathogen_type:
        query = query.filter(Disease.pathogen_type == pathogen_type)
    
    diseases = query.offset(skip).limit(limit).all()
    return diseases


@router.post("/", response_model=DiseaseSchema)
def create_disease(
    disease: DiseaseCreate,
    db: Session = Depends(get_db)
):
    """Create new disease entry in database"""
    # Check if disease already exists
    existing = db.query(Disease).filter(Disease.name == disease.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Disease already exists")
    
    db_disease = Disease(**disease.dict())
    db.add(db_disease)
    db.commit()
    db.refresh(db_disease)
    
    return db_disease


@router.get("/{disease_id}", response_model=DiseaseSchema)
def get_disease(disease_id: int, db: Session = Depends(get_db)):
    """Get disease details by ID"""
    disease = db.query(Disease).filter(Disease.id == disease_id).first()
    if not disease:
        raise HTTPException(status_code=404, detail="Disease not found")
    return disease


@router.post("/predict", response_model=DiseasePredictionResponse)
def predict_disease_risk(
    request: DiseasePredictionRequest,
    db: Session = Depends(get_db)
):
    """
    Predict disease risk for a specific farm
    Provides current risk assessment and optional forecast
    """
    # Validate farm exists
    farm = db.query(Farm).filter(Farm.id == request.farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    # Check if farm has coordinates
    if farm.latitude is None or farm.longitude is None:
        raise HTTPException(
            status_code=400, 
            detail="Farm coordinates not set. Please update farm location before generating predictions."
        )
    
    # Get or create disease record
    disease = db.query(Disease).filter(Disease.name == request.disease_name).first()
    if not disease:
        raise HTTPException(
            status_code=404, 
            detail=f"Disease '{request.disease_name}' not found. Available diseases: Late Blight, Septoria Leaf Spot, Powdery Mildew, Bacterial Spot, Fusarium Wilt"
        )
    
    # Fetch current weather data
    weather_integrator = WeatherDataIntegrator()
    current_weather = weather_integrator.integrate_multi_source_data(
        lat=farm.latitude,
        lon=farm.longitude,
        start_date=datetime.now() - timedelta(days=1),
        end_date=datetime.now()
    )
    
    # Calculate disease risk factors
    disease_risk_factors = weather_integrator.calculate_disease_risk_factors(current_weather)
    current_weather['disease_risk_factors'] = disease_risk_factors
    
    # Get disease-specific prediction
    disease_engine = DiseaseModelEngine()
    disease_name_lower = request.disease_name.lower()
    
    if 'late blight' in disease_name_lower or 'phytophthora' in disease_name_lower:
        disease_prediction = disease_engine.predict_late_blight(
            current_weather, 
            request.crop_type or "potato"
        )
    elif 'septoria' in disease_name_lower:
        disease_prediction = disease_engine.predict_septoria_leaf_spot(
            current_weather,
            request.crop_type or "tomato"
        )
    elif 'powdery mildew' in disease_name_lower:
        disease_prediction = disease_engine.predict_powdery_mildew(
            current_weather,
            request.crop_type or "wheat"
        )
    elif 'bacterial spot' in disease_name_lower:
        disease_prediction = disease_engine.predict_bacterial_spot(
            current_weather,
            request.crop_type or "tomato"
        )
    elif 'fusarium' in disease_name_lower:
        disease_prediction = disease_engine.predict_fusarium_wilt(
            current_weather,
            crop_type=request.crop_type or "tomato"
        )
    else:
        # Generic fungal disease risk
        disease_prediction = {
            'disease_name': request.disease_name,
            'risk_score': disease_risk_factors.get('fungal_risk', 50),
            'risk_level': 'moderate',
            'infection_probability': 0.5,
            'recommended_actions': ["Monitor for symptoms", "Maintain good cultural practices"]
        }
    
    # Store prediction in database
    db_prediction = DiseasePrediction(
        farm_id=request.farm_id,
        disease_id=disease.id,
        prediction_date=datetime.now().date(),
        forecast_horizon="current",
        risk_score=disease_prediction['risk_score'],
        risk_level=disease_prediction['risk_level'],
        infection_probability=disease_prediction.get('infection_probability'),
        days_to_symptom_onset=disease_prediction.get('days_to_symptoms'),
        weather_risk_score=disease_prediction['risk_score'],
        risk_factors=disease_risk_factors,
        weather_conditions=current_weather,
        model_version=settings.DISEASE_MODEL_VERSION,
        confidence_score=disease_prediction.get('confidence_score', 75.0),
        action_threshold_reached=disease_prediction['risk_score'] >= 60,
        recommended_actions=disease_prediction.get('recommended_actions', []),
        treatment_window=disease_prediction.get('action_threshold'),
        estimated_yield_loss_pct=min(disease_prediction['risk_score'] / 2, 50)
    )
    
    db.add(db_prediction)
    db.commit()
    db.refresh(db_prediction)
    
    # Generate forecast if requested
    forecast = None
    if request.forecast_days > 0:
        forecast_engine = ShortTermForecastEngine()
        try:
            weekly_forecast = forecast_engine.generate_weekly_summary(
                farm, 
                request.disease_name,
                db
            )
            forecast = WeeklyForecastSummary(**weekly_forecast)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
    
    # Prepare response
    response = DiseasePredictionResponse(
        prediction=DiseasePredictionSchema.from_orm(db_prediction),
        disease_info=DiseaseSchema.from_orm(disease),
        current_risk=disease_prediction,
        forecast=forecast
    )
    
    return response


@router.get("/predictions/farm/{farm_id}", response_model=List[DiseasePredictionSchema])
def get_farm_predictions(
    farm_id: int,
    limit: int = Query(10, ge=1, le=100),
    disease_name: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Get disease predictions for a specific farm
    Optionally filter by disease name
    """
    query = db.query(DiseasePrediction).filter(DiseasePrediction.farm_id == farm_id)
    
    if disease_name:
        disease = db.query(Disease).filter(Disease.name == disease_name).first()
        if disease:
            query = query.filter(DiseasePrediction.disease_id == disease.id)
    
    predictions = query.order_by(DiseasePrediction.predicted_at.desc()).limit(limit).all()
    
    return predictions


@router.get("/predictions/", response_model=List[DiseasePredictionSchema])
def get_predictions(
    farm_id: Optional[int] = None,
    disease_name: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Get disease predictions with optional filters
    """
    query = db.query(DiseasePrediction)
    
    if farm_id:
        query = query.filter(DiseasePrediction.farm_id == farm_id)
    
    if disease_name:
        disease = db.query(Disease).filter(Disease.name == disease_name).first()
        if disease:
            query = query.filter(DiseasePrediction.disease_id == disease.id)
    
    predictions = query.order_by(DiseasePrediction.predicted_at.desc()).limit(limit).all()
    
    return predictions


@router.get("/forecast/daily/{farm_id}", response_model=List[DailyForecast])
def get_daily_forecast(
    farm_id: int,
    disease_name: str = Query(..., description="Disease name to forecast"),
    days: int = Query(7, ge=1, le=14, description="Number of days to forecast"),
    db: Session = Depends(get_db)
):
    """
    Get daily disease risk forecast for next N days
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    if farm.latitude is None or farm.longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Farm coordinates not set. Please update farm location."
        )
    
    forecast_engine = ShortTermForecastEngine()
    try:
        daily_forecasts = forecast_engine.generate_daily_forecast(
            farm,
            disease_name,
            db,
            forecast_days=days
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    
    return [DailyForecast(**f) for f in daily_forecasts]


@router.get("/forecast/weekly/{farm_id}", response_model=WeeklyForecastSummary)
def get_weekly_forecast(
    farm_id: int,
    disease_name: str = Query(..., description="Disease name to forecast"),
    db: Session = Depends(get_db)
):
    """
    Get 7-day disease risk summary with recommendations
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    if farm.latitude is None or farm.longitude is None:
        raise HTTPException(
            status_code=400,
            detail="Farm coordinates not set. Please update farm location."
        )
    
    forecast_engine = ShortTermForecastEngine()
    try:
        weekly_summary = forecast_engine.generate_weekly_summary(
            farm,
            disease_name,
            db
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    
    return WeeklyForecastSummary(**weekly_summary)


@router.post("/observations", response_model=DiseaseObservationSchema)
def create_observation(
    observation: DiseaseObservationCreate,
    db: Session = Depends(get_db)
):
    """
    Record ground-truth disease observation from field scout or farmer
    Used for model validation and improvement
    """
    # Validate farm exists
    farm = db.query(Farm).filter(Farm.id == observation.farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    # Create observation
    db_observation = DiseaseObservation(**observation.dict())
    db.add(db_observation)
    db.commit()
    db.refresh(db_observation)
    
    return db_observation


@router.get("/observations/farm/{farm_id}", response_model=List[DiseaseObservationSchema])
def get_farm_observations(
    farm_id: int,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Get disease observations for a specific farm"""
    observations = db.query(DiseaseObservation)\
        .filter(DiseaseObservation.farm_id == farm_id)\
        .order_by(DiseaseObservation.observed_at.desc())\
        .limit(limit)\
        .all()
    
    return observations


@router.get("/statistics/{farm_id}")
def get_disease_statistics(
    farm_id: int,
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db)
):
    """
    Get disease statistics and trends for a farm
    """
    farm = db.query(Farm).filter(Farm.id == farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    
    # Get predictions from last N days
    start_date = datetime.now() - timedelta(days=days)
    predictions = db.query(DiseasePrediction)\
        .filter(
            DiseasePrediction.farm_id == farm_id,
            DiseasePrediction.predicted_at >= start_date
        )\
        .all()
    
    if not predictions:
        return {
            "farm_id": farm_id,
            "period_days": days,
            "total_predictions": 0,
            "message": "No predictions available for this period"
        }
    
    # Calculate statistics
    risk_scores = [p.risk_score for p in predictions]
    risk_levels = [p.risk_level for p in predictions]
    
    # Disease breakdown
    disease_counts = {}
    for pred in predictions:
        disease_name = db.query(Disease).filter(Disease.id == pred.disease_id).first().name
        disease_counts[disease_name] = disease_counts.get(disease_name, 0) + 1
    
    # Risk level distribution
    risk_distribution = {
        "low": sum(1 for r in risk_levels if r == "low"),
        "moderate": sum(1 for r in risk_levels if r == "moderate"),
        "high": sum(1 for r in risk_levels if r == "high"),
        "severe": sum(1 for r in risk_levels if r == "severe")
    }
    
    return {
        "farm_id": farm_id,
        "period_days": days,
        "total_predictions": len(predictions),
        "average_risk_score": round(sum(risk_scores) / len(risk_scores), 2),
        "max_risk_score": max(risk_scores),
        "min_risk_score": min(risk_scores),
        "risk_distribution": risk_distribution,
        "disease_counts": disease_counts,
        "high_risk_alerts": risk_distribution["high"] + risk_distribution["severe"]
    }
