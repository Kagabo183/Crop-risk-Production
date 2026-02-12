from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
import random
import math
import logging

from app.db.database import get_db
from app.core.auth import require_agronomist_or_above
from app.models.farm import Farm
from app.models.data import SatelliteImage, VegetationHealth, WeatherRecord
from app.models.disease import Disease, DiseasePrediction, WeatherForecast
from app.models.prediction import Prediction
from app.models.alert import Alert

logger = logging.getLogger(__name__)
router = APIRouter()

# Rwanda farm locations with real coordinates
DEMO_FARMS = [
    {"name": "Rusizi Potato Farm", "location": "Rusizi", "province": "Western", "crop_type": "potato", 
     "lat": -2.4875, "lon": 28.9089, "area": 12.5},
    {"name": "Muhanga Coffee Estate", "location": "Muhanga", "province": "Southern", "crop_type": "coffee", 
     "lat": -2.0847, "lon": 29.7414, "area": 25.0},
    {"name": "Bugesera Maize Fields", "location": "Bugesera", "province": "Eastern", "crop_type": "maize", 
     "lat": -2.2167, "lon": 30.2000, "area": 18.3},
    {"name": "Nyaruguru Bean Cooperative", "location": "Nyaruguru", "province": "Southern", "crop_type": "beans", 
     "lat": -2.6167, "lon": 29.4333, "area": 8.7},
    {"name": "Huye Rice Paddies", "location": "Huye", "province": "Southern", "crop_type": "rice", 
     "lat": -2.5950, "lon": 29.7390, "area": 15.2},
    {"name": "Kayonza Tea Plantation", "location": "Kayonza", "province": "Eastern", "crop_type": "tea", 
     "lat": -1.8833, "lon": 30.4167, "area": 35.0},
    {"name": "Nyagatare Wheat Farm", "location": "Nyagatare", "province": "Eastern", "crop_type": "wheat", 
     "lat": -1.2983, "lon": 30.3239, "area": 42.0},
    {"name": "Gicumbi Potato Valley", "location": "Gicumbi", "province": "Northern", "crop_type": "potato", 
     "lat": -1.6833, "lon": 29.9833, "area": 10.5},
]

# Disease catalog
DISEASES = [
    {
        "name": "Late Blight",
        "scientific_name": "Phytophthora infestans",
        "pathogen_type": "fungal",
        "primary_crops": ["potato", "tomato"],
        "optimal_temp_min": 10.0,
        "optimal_temp_max": 25.0,
        "optimal_humidity_min": 90.0,
        "required_leaf_wetness_hours": 12.0,
        "incubation_period_days": 5,
        "severity_potential": "severe",
        "spread_rate": "fast",
        "symptoms": "Brown lesions on leaves, white fuzzy growth on underside, black stems",
        "management_practices": ["Fungicide application", "Resistant varieties", "Crop rotation", "Remove infected plants"],
        "chemical_controls": ["Chlorothalonil", "Mancozeb", "Metalaxyl"],
    },
    {
        "name": "Early Blight",
        "scientific_name": "Alternaria solani",
        "pathogen_type": "fungal",
        "primary_crops": ["potato", "tomato"],
        "optimal_temp_min": 24.0,
        "optimal_temp_max": 29.0,
        "optimal_humidity_min": 80.0,
        "incubation_period_days": 7,
        "severity_potential": "moderate",
        "spread_rate": "moderate",
        "symptoms": "Concentric ring spots on leaves, yellowing, defoliation",
        "management_practices": ["Crop rotation", "Proper spacing", "Fungicide sprays", "Sanitation"],
        "chemical_controls": ["Azoxystrobin", "Chlorothalonil", "Mancozeb"],
    },
    {
        "name": "Coffee Leaf Rust",
        "scientific_name": "Hemileia vastatrix",
        "pathogen_type": "fungal",
        "primary_crops": ["coffee"],
        "optimal_temp_min": 21.0,
        "optimal_temp_max": 25.0,
        "optimal_humidity_min": 85.0,
        "incubation_period_days": 14,
        "severity_potential": "high",
        "spread_rate": "fast",
        "symptoms": "Orange-yellow powdery lesions on leaf undersides, premature leaf drop",
        "management_practices": ["Resistant varieties", "Shade management", "Copper fungicides", "Pruning"],
        "chemical_controls": ["Copper hydroxide", "Triadimefon", "Propiconazole"],
    },
    {
        "name": "Bean Anthracnose",
        "scientific_name": "Colletotrichum lindemuthianum",
        "pathogen_type": "fungal",
        "primary_crops": ["beans"],
        "optimal_temp_min": 13.0,
        "optimal_temp_max": 27.0,
        "optimal_humidity_min": 92.0,
        "incubation_period_days": 6,
        "severity_potential": "high",
        "spread_rate": "moderate",
        "symptoms": "Dark brown lesions on pods and stems, sunken spots with red borders",
        "management_practices": ["Disease-free seed", "Crop rotation", "Avoid overhead irrigation", "Fungicides"],
        "chemical_controls": ["Chlorothalonil", "Mancozeb", "Benomyl"],
    },
    {
        "name": "Maize Lethal Necrosis",
        "scientific_name": "MCMV + SCMV",
        "pathogen_type": "viral",
        "primary_crops": ["maize"],
        "optimal_temp_min": 20.0,
        "optimal_temp_max": 30.0,
        "incubation_period_days": 14,
        "severity_potential": "severe",
        "spread_rate": "fast",
        "symptoms": "Chlorotic mottling, leaf necrosis, dead hearts, premature death",
        "management_practices": ["Resistant varieties", "Control thrips vectors", "Early planting", "Field sanitation"],
        "chemical_controls": ["Insecticides for vector control"],
    },
]


@router.post("/seed-all")
def seed_all_demo_data(
    db: Session = Depends(get_db),
    _current_user=Depends(require_agronomist_or_above),
):
    """
    Populate comprehensive demo data for all pages.
    Creates farms, satellite images, vegetation health, weather, diseases, predictions, and alerts.
    """
    try:
        summary = {
            "farms": 0,
            "satellite_images": 0,
            "vegetation_health": 0,
            "weather_records": 0,
            "weather_forecasts": 0,
            "diseases": 0,
            "disease_predictions": 0,
            "predictions": 0,
            "alerts": 0,
        }
        
        # Clear existing simulated data
        logger.info("Clearing existing simulated data...")
        db.query(SatelliteImage).filter(SatelliteImage.source == "simulated").delete(synchronize_session=False)
        db.query(VegetationHealth).delete(synchronize_session=False)
        db.query(WeatherRecord).filter(WeatherRecord.source == "simulated").delete(synchronize_session=False)
        db.query(WeatherForecast).filter(WeatherForecast.source == "simulated").delete(synchronize_session=False)
        db.query(DiseasePrediction).delete(synchronize_session=False)
        db.query(Prediction).delete(synchronize_session=False)
        db.query(Alert).filter(Alert.source == "simulated").delete(synchronize_session=False)
        
        # Only delete farms that were created as demo farms
        existing_farms = db.query(Farm).filter(Farm.name.in_([f["name"] for f in DEMO_FARMS])).all()
        for farm in existing_farms:
            db.delete(farm)
        
        db.commit()
        
        # 1. Create Farms
        logger.info("Creating demo farms...")
        farms = []
        for farm_data in DEMO_FARMS:
            farm = Farm(
                name=farm_data["name"],
                location=farm_data["location"],
                province=farm_data["province"],
                crop_type=farm_data["crop_type"],
                latitude=farm_data["lat"],
                longitude=farm_data["lon"],
                area=farm_data["area"],
                planting_date=date.today() - timedelta(days=random.randint(60, 120))
            )
            db.add(farm)
            farms.append(farm)
        db.flush()
        summary["farms"] = len(farms)
        
        # 2. Create Diseases
        logger.info("Creating disease catalog...")
        disease_objs = {}
        for disease_data in DISEASES:
            disease = Disease(**disease_data)
            db.add(disease)
            disease_objs[disease_data["name"]] = disease
        db.flush()
        summary["diseases"] = len(disease_objs)
        
        # 3. Generate 6 months of data for each farm
        end_date = datetime.now()
        start_date = end_date - timedelta(days=180)
        
        for farm in farms:
            logger.info(f"Generating data for {farm.name}...")
            
            # Base NDVI for this farm (varies by crop and health)
            base_ndvi = random.uniform(0.45, 0.75)
            
            # Generate time series data
            current_date = start_date
            day_count = 0
            
            while current_date <= end_date:
                # Seasonal variation (sine wave)
                seasonal = 0.1 * math.sin((day_count / 180) * math.pi * 2)
                
                # Random noise
                noise = random.uniform(-0.05, 0.05)
                
                # Occasional stress events (10% chance)
                stress_factor = 1.0
                if random.random() < 0.1:
                    stress_factor = random.uniform(0.7, 0.9)
                
                # Calculate NDVI
                ndvi = base_ndvi + seasonal + noise
                ndvi = ndvi * stress_factor
                ndvi = max(0.15, min(0.95, ndvi))
                
                # Other vegetation indices (correlated with NDVI)
                ndre = ndvi * random.uniform(0.8, 1.1)
                ndwi = random.uniform(0.2, 0.6)
                evi = ndvi * random.uniform(0.9, 1.2)
                savi = ndvi * random.uniform(0.85, 1.0)
                
                # Cloud cover
                cloud_cover = random.uniform(0, 100)
                
                # Create Satellite Image
                sat_image = SatelliteImage(
                    farm_id=farm.id,
                    date=current_date.date(),
                    acquisition_date=current_date,
                    region=farm.location,
                    image_type="NDVI",
                    file_path=f"simulated/{farm.id}/{current_date.date()}.tif",
                    source="simulated",
                    cloud_cover_percent=cloud_cover,
                    processing_status="completed",
                    mean_ndvi=round(ndvi, 4),
                    mean_ndre=round(ndre, 4),
                    mean_ndwi=round(ndwi, 4),
                    mean_evi=round(evi, 4),
                    mean_savi=round(savi, 4),
                    extra_metadata={"simulated": True}
                )
                db.add(sat_image)
                summary["satellite_images"] += 1
                
                # Create Vegetation Health
                health_score = min(100, max(0, ndvi * 100))
                if ndvi >= 0.7:
                    stress_level = 'none'
                    stress_type = None
                elif ndvi >= 0.5:
                    stress_level = 'low'
                    stress_type = random.choice(['water', 'nutrient'])
                elif ndvi >= 0.4:
                    stress_level = 'moderate'
                    stress_type = random.choice(['drought', 'heat', 'water'])
                elif ndvi >= 0.3:
                    stress_level = 'high'
                    stress_type = random.choice(['drought', 'heat'])
                else:
                    stress_level = 'severe'
                    stress_type = 'drought'
                
                veg_health = VegetationHealth(
                    farm_id=farm.id,
                    date=current_date.date(),
                    ndvi=round(ndvi, 4),
                    ndre=round(ndre, 4),
                    ndwi=round(ndwi, 4),
                    evi=round(evi, 4),
                    savi=round(savi, 4),
                    health_score=round(health_score, 2),
                    stress_level=stress_level,
                    stress_type=stress_type
                )
                db.add(veg_health)
                summary["vegetation_health"] += 1
                
                # Create Weather Record
                # Rwanda climate: 15-30°C, 50-95% humidity, seasonal rainfall
                temp = random.uniform(16, 28)
                temp_variation = random.uniform(3, 7)
                
                weather = WeatherRecord(
                    farm_id=farm.id,
                    date=current_date.date(),
                    region=farm.location,
                    rainfall=random.uniform(0, 30) if random.random() < 0.4 else 0,
                    temperature=round(temp, 1),
                    temperature_min=round(temp - temp_variation, 1),
                    temperature_max=round(temp + temp_variation, 1),
                    humidity=random.uniform(60, 95),
                    wind_speed=random.uniform(0.5, 5.0),
                    source="simulated",
                    extra_metadata={"simulated": True}
                )
                db.add(weather)
                summary["weather_records"] += 1
                
                # Advance to next observation (every 5-10 days)
                current_date += timedelta(days=random.randint(5, 10))
                day_count += random.randint(5, 10)
            
            # Create 7-day weather forecast for this farm
            for i in range(7):
                forecast_date = date.today() + timedelta(days=i)
                temp = random.uniform(18, 27)
                
                forecast = WeatherForecast(
                    location=f"{farm.latitude},{farm.longitude}",
                    forecast_date=date.today(),
                    valid_date=forecast_date,
                    forecast_horizon_hours=i * 24,
                    temperature_min=round(temp - random.uniform(3, 6), 1),
                    temperature_max=round(temp + random.uniform(3, 6), 1),
                    temperature_mean=round(temp, 1),
                    humidity_min=random.uniform(50, 70),
                    humidity_max=random.uniform(80, 95),
                    humidity_mean=random.uniform(70, 85),
                    rainfall_total=random.uniform(0, 20) if random.random() < 0.3 else 0,
                    rainfall_probability=random.uniform(0, 1),
                    wind_speed=random.uniform(1, 5),
                    leaf_wetness_hours=random.uniform(0, 12),
                    source="simulated",
                    confidence=random.uniform(0.7, 0.95)
                )
                db.add(forecast)
                summary["weather_forecasts"] += 1
            
            # Create Disease Predictions for applicable crops
            for disease_name, disease in disease_objs.items():
                if farm.crop_type in (disease.primary_crops or []):
                    # Create predictions for next 7 days
                    for i in range(7):
                        prediction_date = date.today() + timedelta(days=i)
                        
                        # Risk increases with forecast horizon and weather conditions
                        base_risk = random.uniform(20, 70)
                        horizon_factor = 1 + (i * 0.05)
                        risk_score = min(100, base_risk * horizon_factor)
                        
                        if risk_score < 30:
                            risk_level = "low"
                        elif risk_score < 55:
                            risk_level = "moderate"
                        elif risk_score < 75:
                            risk_level = "high"
                        else:
                            risk_level = "severe"
                        
                        disease_pred = DiseasePrediction(
                            farm_id=farm.id,
                            disease_id=disease.id,
                            prediction_date=prediction_date,
                            forecast_horizon=f"{i}-day" if i > 0 else "current",
                            risk_score=round(risk_score, 2),
                            risk_level=risk_level,
                            infection_probability=round(risk_score / 100, 2),
                            disease_stage="pre-infection" if risk_level == "low" else "infection",
                            days_to_symptom_onset=random.randint(3, 10) if risk_score > 50 else None,
                            weather_risk_score=round(random.uniform(30, 90), 2),
                            host_susceptibility_score=round(random.uniform(40, 80), 2),
                            pathogen_pressure_score=round(random.uniform(20, 70), 2),
                            action_threshold_reached=risk_score > 60,
                            recommended_actions=["Monitor closely", "Apply fungicide", "Scout fields"] if risk_score > 60 else ["Continue monitoring"],
                            treatment_window="immediate" if risk_score > 75 else "within 48h" if risk_score > 60 else None,
                            estimated_yield_loss_pct=round(risk_score * 0.5, 1) if risk_score > 50 else 0,
                            confidence_score=round(random.uniform(70, 95), 2)
                        )
                        db.add(disease_pred)
                        summary["disease_predictions"] += 1
            
            # Create ML Risk Prediction
            avg_ndvi = base_ndvi
            risk_score = max(10, min(100, (1 - avg_ndvi) * 120))
            
            risk_drivers = {
                "ndvi_trend": round(random.uniform(25, 45), 1),
                "rainfall_deficit": round(random.uniform(15, 35), 1),
                "temperature_stress": round(random.uniform(10, 25), 1),
                "disease_pressure": round(random.uniform(10, 30), 1)
            }
            
            prediction = Prediction(
                farm_id=farm.id,
                risk_score=round(risk_score, 2),
                yield_loss=round(risk_score * 0.4, 1),
                disease_risk="high" if risk_score > 60 else "moderate" if risk_score > 35 else "low",
                time_to_impact="< 7 days" if risk_score > 70 else "7-14 days",
                confidence_level="High" if avg_ndvi > 0.5 else "Medium",
                confidence_score=round(random.uniform(75, 95), 2),
                risk_drivers=risk_drivers,
                risk_explanation=f"Risk driven primarily by vegetation health trends and environmental stress factors.",
                recommendations=[
                    "Monitor vegetation health daily",
                    "Increase irrigation if possible",
                    "Scout for pest and disease symptoms",
                    "Apply appropriate treatments as needed"
                ] if risk_score > 50 else ["Continue regular monitoring"],
                impact_metrics={"estimated_loss_usd": round(risk_score * 100, 2)}
            )
            db.add(prediction)
            summary["predictions"] += 1
            
            # Create Alert if risk is high
            if risk_score > 60 or avg_ndvi < 0.4:
                alert_type = "ndvi_decline" if avg_ndvi < 0.4 else "high_risk"
                severity = "critical" if risk_score > 75 else "high"
                
                alert = Alert(
                    farm_id=farm.id,
                    alert_type=alert_type,
                    message=f"High risk detected for {farm.name}. NDVI: {avg_ndvi:.3f}, Risk Score: {risk_score:.1f}",
                    severity=severity,
                    source="simulated",
                    alert_data={
                        "ndvi": round(avg_ndvi, 3),
                        "risk_score": round(risk_score, 1),
                        "crop_type": farm.crop_type
                    },
                    resolved=False
                )
                db.add(alert)
                summary["alerts"] += 1
        
        db.commit()
        logger.info("Demo data seeding completed successfully")
        
        return {
            "success": True,
            "message": "Demo data populated successfully",
            "summary": summary
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error seeding demo data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to seed demo data: {str(e)}")


@router.delete("/seed-all")
def clear_demo_data(
    db: Session = Depends(get_db),
    _current_user=Depends(require_agronomist_or_above),
):
    """
    Clear all simulated demo data from the database.
    """
    try:
        # Delete simulated data
        sat_deleted = db.query(SatelliteImage).filter(SatelliteImage.source == "simulated").delete(synchronize_session=False)
        veg_deleted = db.query(VegetationHealth).delete(synchronize_session=False)
        weather_deleted = db.query(WeatherRecord).filter(WeatherRecord.source == "simulated").delete(synchronize_session=False)
        forecast_deleted = db.query(WeatherForecast).filter(WeatherForecast.source == "simulated").delete(synchronize_session=False)
        disease_pred_deleted = db.query(DiseasePrediction).delete(synchronize_session=False)
        pred_deleted = db.query(Prediction).delete(synchronize_session=False)
        alert_deleted = db.query(Alert).filter(Alert.source == "simulated").delete(synchronize_session=False)
        
        # Delete demo farms
        demo_farm_names = [f["name"] for f in DEMO_FARMS]
        farms_deleted = db.query(Farm).filter(Farm.name.in_(demo_farm_names)).delete(synchronize_session=False)
        
        db.commit()
        
        return {
            "success": True,
            "message": "Demo data cleared successfully",
            "deleted": {
                "farms": farms_deleted,
                "satellite_images": sat_deleted,
                "vegetation_health": veg_deleted,
                "weather_records": weather_deleted,
                "weather_forecasts": forecast_deleted,
                "disease_predictions": disease_pred_deleted,
                "predictions": pred_deleted,
                "alerts": alert_deleted
            }
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error clearing demo data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear demo data: {str(e)}")
