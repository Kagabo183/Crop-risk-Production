"""
Disease Prediction Intelligence - Pathogen-specific models and forecasting
Implements research-backed disease models from universities and CPN
"""
import numpy as np
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.disease import Disease, DiseasePrediction, DiseaseModelConfig, WeatherForecast
from app.models.farm import Farm
from app.services.weather_service import WeatherDataIntegrator
from app.core.config import settings


class DiseaseModelEngine:
    """
    Pathogen-specific disease prediction models
    Based on research from university plant pathology programs
    """
    
    def __init__(self):
        self.weather_integrator = WeatherDataIntegrator()
    
    def predict_late_blight(
        self, 
        weather_data: Dict, 
        crop_type: str = "potato",
        forecast_days: int = 7
    ) -> Dict:
        """
        Late Blight (Phytophthora infestans) prediction
        Based on: Smith Period Model (Cornell University)
        
        Smith Period: Disease favorable when:
        - Min temp ≥10°C (50°F)
        - Relative humidity ≥90% for 11+ consecutive hours
        """
        temp = weather_data.get('temperature') or 15
        humidity = weather_data.get('humidity') or 70
        rainfall = weather_data.get('rainfall') or 0
        leaf_wetness = weather_data.get('leaf_wetness') or 0
        
        # Smith Period criteria
        smith_period_met = False
        if temp >= 10 and humidity >= 90 and leaf_wetness * 24 >= 11:
            smith_period_met = True
        
        # Severity Values (0-4 scale)
        if smith_period_met:
            if temp >= 15 and temp <= 20:
                severity = 4  # Most favorable
            elif temp >= 10 and temp < 15:
                severity = 3
            elif temp > 20 and temp <= 25:
                severity = 2
            else:
                severity = 1
        else:
            severity = 0
        
        # Calculate accumulated disease units
        if severity > 0:
            disease_units = severity * (rainfall + 5)  # Rainfall amplifies risk
        else:
            disease_units = 0
        
        # Risk score (0-100)
        risk_score = min(100, disease_units * 2)
        
        # Risk level
        if risk_score >= 80:
            risk_level = "severe"
            action = "immediate"
        elif risk_score >= 60:
            risk_level = "high"
            action = "within_24h"
        elif risk_score >= 40:
            risk_level = "moderate"
            action = "within_3_days"
        else:
            risk_level = "low"
            action = "monitor"
        
        # Days to symptom onset (based on temperature)
        if smith_period_met:
            if temp >= 18:
                days_to_symptoms = 3
            elif temp >= 15:
                days_to_symptoms = 5
            else:
                days_to_symptoms = 7
        else:
            days_to_symptoms = None
        
        # Calculate confidence based on data quality
        confidence = self._calculate_prediction_confidence(
            weather_data, 
            required_params=['temperature', 'humidity', 'leaf_wetness', 'rainfall']
        )
        
        return {
            'disease_name': 'Late Blight',
            'risk_score': round(risk_score, 2),
            'risk_level': risk_level,
            'smith_period_met': smith_period_met,
            'severity_value': severity,
            'disease_units': round(disease_units, 2),
            'days_to_symptoms': days_to_symptoms,
            'action_threshold': action,
            'infection_probability': min(1.0, risk_score / 100),
            'confidence_score': round(confidence, 2),
            'recommended_actions': self._get_late_blight_actions(risk_level),
            'research_source': 'Cornell University Smith Period Model'
        }
    
    def predict_septoria_leaf_spot(
        self,
        weather_data: Dict,
        crop_type: str = "tomato"
    ) -> Dict:
        """
        Septoria Leaf Spot prediction
        Based on: TOM-CAST model (Ohio State University)
        
        Disease favorable when:
        - Temperature 15-27°C
        - High humidity (>80%)
        - Leaf wetness present
        """
        temp = weather_data.get('temperature') or 20
        humidity = weather_data.get('humidity') or 70
        leaf_wetness_hours = (weather_data.get('leaf_wetness') or 0) * 24
        
        # Daily Disease Severity Value (DSV)
        dsv = 0
        
        if leaf_wetness_hours >= 0:
            if 15 <= temp <= 27:
                if leaf_wetness_hours >= 15:
                    dsv = 4
                elif leaf_wetness_hours >= 10:
                    dsv = 3
                elif leaf_wetness_hours >= 6:
                    dsv = 2
                elif leaf_wetness_hours >= 3:
                    dsv = 1
            elif 13 <= temp < 15 or 27 < temp <= 30:
                if leaf_wetness_hours >= 18:
                    dsv = 3
                elif leaf_wetness_hours >= 12:
                    dsv = 2
                elif leaf_wetness_hours >= 6:
                    dsv = 1
        
        # Accumulated DSV
        accumulated_dsv = dsv * 7  # Simulate 7-day accumulation
        
        # Risk score
        risk_score = min(100, accumulated_dsv * 5)
        
        # Risk level (spray threshold typically at 15-20 DSV)
        if accumulated_dsv >= 20:
            risk_level = "severe"
            action = "immediate"
        elif accumulated_dsv >= 15:
            risk_level = "high"
            action = "within_24h"
        elif accumulated_dsv >= 10:
            risk_level = "moderate"
            action = "within_3_days"
        else:
            risk_level = "low"
            action = "monitor"
        
        # Calculate confidence
        confidence = self._calculate_prediction_confidence(
            weather_data,
            required_params=['temperature', 'humidity', 'leaf_wetness']
        )
        
        return {
            'disease_name': 'Septoria Leaf Spot',
            'risk_score': round(risk_score, 2),
            'risk_level': risk_level,
            'daily_severity_value': dsv,
            'accumulated_dsv': accumulated_dsv,
            'spray_threshold_reached': accumulated_dsv >= 15,
            'action_threshold': action,
            'infection_probability': min(1.0, accumulated_dsv / 25),
            'confidence_score': round(confidence, 2),
            'recommended_actions': self._get_septoria_actions(risk_level),
            'research_source': 'TOM-CAST Model (Ohio State University)'
        }
    
    def predict_powdery_mildew(
        self,
        weather_data: Dict,
        crop_type: str = "wheat"
    ) -> Dict:
        """
        Powdery Mildew prediction
        
        Disease favorable when:
        - Temperature 15-22°C (optimal 18-20°C)
        - Moderate humidity 40-70% (NOT very high)
        - Dry foliage with high humidity air
        """
        temp = weather_data.get('temperature') or 18
        humidity = weather_data.get('humidity') or 60
        rainfall = weather_data.get('rainfall') or 0
        
        # Temperature risk
        if 18 <= temp <= 20:
            temp_risk = 1.0
        elif 15 <= temp < 18 or 20 < temp <= 22:
            temp_risk = 0.8
        elif 12 <= temp < 15 or 22 < temp <= 25:
            temp_risk = 0.5
        else:
            temp_risk = 0.2
        
        # Humidity risk (unique - prefers moderate, not very high)
        if 50 <= humidity <= 70:
            humidity_risk = 1.0
        elif 40 <= humidity < 50 or 70 < humidity <= 80:
            humidity_risk = 0.7
        else:
            humidity_risk = 0.4
        
        # Rainfall reduces risk (washes spores away)
        rain_factor = max(0.3, 1.0 - (rainfall / 10))
        
        # Combined risk
        risk_score = (temp_risk * 0.4 + humidity_risk * 0.4) * rain_factor * 100
        
        # Risk level
        if risk_score >= 75:
            risk_level = "severe"
        elif risk_score >= 60:
            risk_level = "high"
        elif risk_score >= 40:
            risk_level = "moderate"
        else:
            risk_level = "low"
        
        # Calculate confidence
        confidence = self._calculate_prediction_confidence(
            weather_data,
            required_params=['temperature', 'humidity', 'rainfall']
        )
        
        return {
            'disease_name': 'Powdery Mildew',
            'risk_score': round(risk_score, 2),
            'risk_level': risk_level,
            'temp_risk': round(temp_risk, 2),
            'humidity_risk': round(humidity_risk, 2),
            'rain_suppression_factor': round(rain_factor, 2),
            'infection_probability': min(1.0, risk_score / 100),
            'confidence_score': round(confidence, 2),
            'recommended_actions': self._get_powdery_mildew_actions(risk_level)
        }
    
    def predict_bacterial_spot(
        self,
        weather_data: Dict,
        crop_type: str = "tomato"
    ) -> Dict:
        """
        Bacterial Spot (Xanthomonas) prediction
        
        Disease favorable when:
        - Warm temperatures (24-30°C)
        - High rainfall and wind (splash dispersal)
        - Extended leaf wetness
        """
        temp = weather_data.get('temperature') or 25
        rainfall = weather_data.get('rainfall') or 0
        wind_speed = weather_data.get('wind_speed') or 0
        leaf_wetness = weather_data.get('leaf_wetness') or 0
        
        # Temperature risk
        if 24 <= temp <= 30:
            temp_risk = 1.0
        elif 20 <= temp < 24 or 30 < temp <= 35:
            temp_risk = 0.7
        else:
            temp_risk = 0.3
        
        # Rainfall + wind (splash dispersal)
        splash_risk = min(1.0, (rainfall / 5) * (1 + wind_speed / 10))
        
        # Leaf wetness
        wetness_risk = leaf_wetness
        
        # Combined risk
        risk_score = (temp_risk * 0.3 + splash_risk * 0.4 + wetness_risk * 0.3) * 100
        
        # Risk level
        if risk_score >= 75:
            risk_level = "severe"
        elif risk_score >= 60:
            risk_level = "high"
        elif risk_score >= 40:
            risk_level = "moderate"
        else:
            risk_level = "low"
        
        # Calculate confidence
        confidence = self._calculate_prediction_confidence(
            weather_data,
            required_params=['temperature', 'rainfall', 'wind_speed', 'leaf_wetness']
        )
        
        return {
            'disease_name': 'Bacterial Spot',
            'risk_score': round(risk_score, 2),
            'risk_level': risk_level,
            'splash_dispersal_risk': round(splash_risk, 2),
            'infection_probability': min(1.0, risk_score / 100),
            'confidence_score': round(confidence, 2),
            'recommended_actions': self._get_bacterial_spot_actions(risk_level)
        }
    
    def predict_fusarium_wilt(
        self,
        weather_data: Dict,
        soil_temp: float = None,
        crop_type: str = "tomato"
    ) -> Dict:
        """
        Fusarium Wilt prediction
        
        Disease favorable when:
        - High soil temperature (27-32°C)
        - Moderate moisture (not saturated)
        - Stressed plants
        """
        air_temp = weather_data.get('temperature') or 25
        soil_temp = soil_temp if soil_temp else air_temp + 3  # Soil typically warmer
        
        # Soil temperature risk
        if 27 <= soil_temp <= 32:
            temp_risk = 1.0
        elif 24 <= soil_temp < 27 or 32 < soil_temp <= 35:
            temp_risk = 0.6
        else:
            temp_risk = 0.3
        
        # Moderate soil moisture (not waterlogged)
        # Estimate from air conditions
        humidity = weather_data.get('humidity') or 60
        if 50 <= humidity <= 75:
            moisture_risk = 0.8
        else:
            moisture_risk = 0.5
        
        risk_score = (temp_risk * 0.7 + moisture_risk * 0.3) * 100
        
        if risk_score >= 70:
            risk_level = "high"
        elif risk_score >= 50:
            risk_level = "moderate"
        else:
            risk_level = "low"
        
        # Calculate confidence
        confidence = self._calculate_prediction_confidence(
            weather_data,
            required_params=['temperature', 'humidity']
        )
        
        return {
            'disease_name': 'Fusarium Wilt',
            'risk_score': round(risk_score, 2),
            'risk_level': risk_level,
            'soil_temp': round(soil_temp, 2),
            'infection_probability': min(1.0, risk_score / 100),
            'confidence_score': round(confidence, 2),
            'recommended_actions': self._get_fusarium_actions(risk_level)
        }
    
    def _get_late_blight_actions(self, risk_level: str) -> List[str]:
        """Get IPM recommendations for Late Blight"""
        if risk_level in ["severe", "high"]:
            return [
                "Apply fungicide immediately (chlorothalonil, mancozeb, or copper)",
                "Scout fields daily for symptoms",
                "Remove and destroy infected plants",
                "Improve air circulation",
                "Reduce irrigation if possible",
                "Consider preventive spray schedule (5-7 day intervals)"
            ]
        elif risk_level == "moderate":
            return [
                "Scout fields every 2-3 days",
                "Prepare fungicide for application",
                "Monitor weather forecasts closely",
                "Ensure good field drainage"
            ]
        else:
            return [
                "Continue routine monitoring",
                "Maintain good cultural practices"
            ]
    
    def _get_septoria_actions(self, risk_level: str) -> List[str]:
        """Get IPM recommendations for Septoria"""
        if risk_level in ["severe", "high"]:
            return [
                "Apply fungicide (chlorothalonil, mancozeb, azoxystrobin)",
                "Remove lower infected leaves",
                "Increase plant spacing for airflow",
                "Avoid overhead irrigation"
            ]
        elif risk_level == "moderate":
            return [
                "Monitor for first symptoms",
                "Remove lower leaves touching soil",
                "Prepare for fungicide application"
            ]
        else:
            return [
                "Maintain sanitation",
                "Monitor weekly"
            ]
    
    def _get_powdery_mildew_actions(self, risk_level: str) -> List[str]:
        """Get IPM recommendations for Powdery Mildew"""
        if risk_level in ["severe", "high"]:
            return [
                "Apply sulfur-based fungicide or potassium bicarbonate",
                "Improve air circulation",
                "Reduce humidity around plants",
                "Remove heavily infected leaves"
            ]
        else:
            return [
                "Monitor for white powdery spots",
                "Maintain good spacing"
            ]
    
    def _get_bacterial_spot_actions(self, risk_level: str) -> List[str]:
        """Get IPM recommendations for Bacterial Spot"""
        if risk_level in ["severe", "high"]:
            return [
                "Apply copper-based bactericide",
                "Avoid overhead irrigation",
                "Remove infected plant debris",
                "Increase plant spacing",
                "Do not work in wet fields"
            ]
        else:
            return [
                "Scout for symptoms",
                "Practice good sanitation"
            ]
    
    def _get_fusarium_actions(self, risk_level: str) -> List[str]:
        """Get IPM recommendations for Fusarium Wilt"""
        return [
            "Use resistant varieties (primary control)",
            "Avoid soil compaction",
            "Maintain optimal soil pH",
            "Practice crop rotation",
            "Solarize soil if possible",
            "No effective chemical control - focus on prevention"
        ]

    def _calculate_prediction_confidence(
        self,
        weather_data: Dict,
        required_params: List[str],
    ) -> float:
        """Calculate prediction confidence based on weather data quality.

        Returns a 0-100 style confidence score.
        """
        data_source = weather_data.get('source', 'fallback')
        base_confidence = {
            'local': 95.0,
            'open-meteo': 88.0,
            'openmeteo': 88.0,
            'noaa': 85.0,
            'era5': 82.0,
            'ibm': 75.0,
            'fallback': 60.0,
            'merged': 90.0,
        }.get(data_source, 70.0)

        missing_params = 0
        default_used = 0
        for param in required_params:
            value = weather_data.get(param)
            if value is None:
                missing_params += 1
            elif param == 'temperature' and value in [15, 18, 20, 22, 25]:
                default_used += 0.5
            elif param == 'humidity' and value == 70:
                default_used += 0.5
            elif param == 'rainfall' and value == 0:
                default_used += 0.3

        completeness_penalty = (missing_params * 15) + (default_used * 5)
        return max(40.0, base_confidence - completeness_penalty)


class ShortTermForecastEngine:
    """
    Daily and weekly disease risk forecasting
    Extends from monthly to match CPN's decision-making timeframe
    """
    
    def __init__(self):
        self.weather_integrator = WeatherDataIntegrator()
        self.disease_engine = DiseaseModelEngine()
    
    def generate_daily_forecast(
        self,
        farm: Farm,
        disease_name: str,
        db: Session,
        forecast_days: int = 7
    ) -> List[Dict]:
        """
        Generate daily disease risk forecast for next N days
        """
        forecasts = []
        
        for day_offset in range(1, forecast_days + 1):
            forecast_date = datetime.now().date() + timedelta(days=day_offset)
            
            # Get weather forecast for this day
            weather_forecast = self._get_weather_forecast(farm, day_offset, db)

            if settings.REQUIRE_REAL_WEATHER:
                self._validate_real_weather_input(farm, weather_forecast, day_offset)
            
            # Calculate disease risk based on forecasted weather
            disease_risk = self._calculate_disease_risk(
                disease_name,
                weather_forecast
            )
            
            forecasts.append({
                'date': forecast_date,
                'day_offset': day_offset,
                'forecast_horizon': f"{day_offset}-day",
                'disease_name': disease_name,
                'risk_score': disease_risk['risk_score'],
                'risk_level': disease_risk['risk_level'],
                'weather': weather_forecast,
                'confidence': self._calculate_forecast_confidence(day_offset),
                'actionable': disease_risk.get('risk_score', 0) >= 60
            })
        
        return forecasts
    
    def generate_weekly_summary(
        self,
        farm: Farm,
        disease_name: str,
        db: Session
    ) -> Dict:
        """
        Generate 7-day disease risk summary
        """
        daily_forecasts = self.generate_daily_forecast(farm, disease_name, db, 7)
        
        # Aggregate weekly statistics
        risk_scores = [f['risk_score'] for f in daily_forecasts]
        risk_levels = [f['risk_level'] for f in daily_forecasts]
        
        # Peak risk day
        peak_day = max(daily_forecasts, key=lambda x: x['risk_score'])
        
        # Critical action days (risk >= 60)
        critical_days = [f for f in daily_forecasts if f['actionable']]
        
        # Overall weekly risk
        avg_risk = np.mean(risk_scores)
        max_risk = max(risk_scores)
        
        if max_risk >= 80:
            weekly_risk = "severe"
        elif max_risk >= 60:
            weekly_risk = "high"
        elif avg_risk >= 40:
            weekly_risk = "moderate"
        else:
            weekly_risk = "low"
        
        return {
            'disease_name': disease_name,
            'forecast_period': '7-day',
            'start_date': daily_forecasts[0]['date'],
            'end_date': daily_forecasts[-1]['date'],
            'weekly_risk_level': weekly_risk,
            'average_risk_score': round(avg_risk, 2),
            'peak_risk_score': round(max_risk, 2),
            'peak_risk_day': peak_day['date'],
            'critical_action_days': len(critical_days),
            'critical_dates': [d['date'] for d in critical_days],
            'daily_forecasts': daily_forecasts,
            'recommended_strategy': self._get_weekly_strategy(weekly_risk, critical_days)
        }
    
    def _get_weather_forecast(self, farm: Farm, day_offset: int, db: Session) -> Dict:
        """
        Get weather forecast for specific day
        In production, integrate with NOAA/ERA5 forecast APIs
        """
        # Check database for existing forecast
        forecast_date = datetime.now().date() + timedelta(days=day_offset)
        
        existing = db.query(WeatherForecast).filter(
            WeatherForecast.location == f"Lat:{farm.latitude or 0:.2f},Lon:{farm.longitude or 0:.2f}",
            WeatherForecast.valid_date == forecast_date
        ).first()
        
        if existing:
            return {
                'temperature': existing.temperature_mean,
                'humidity': existing.humidity_mean,
                'rainfall': existing.rainfall_total,
                'leaf_wetness': existing.leaf_wetness_hours / 24,
                'wind_speed': existing.wind_speed,
                'source': existing.source
            }
        
        # Fallback: Fetch from API
        try:
            weather = self.weather_integrator.integrate_multi_source_data(
                farm.latitude or 0.0,
                farm.longitude or 0.0,
                datetime.now(),
                datetime.now() + timedelta(days=day_offset)
            )
            if isinstance(weather, dict):
                source = str(weather.get('source') or '').lower()
                if source not in {'climatology', 'fallback'} and weather.get('leaf_wetness') is None:
                    factors = self.weather_integrator.calculate_disease_risk_factors(weather)
                    leaf_wetness_hours = factors.get('leaf_wetness_hours')
                    if leaf_wetness_hours is not None:
                        weather['leaf_wetness'] = max(0.0, min(1.0, float(leaf_wetness_hours) / 24.0))
            return weather
        except:
            # Use climatology
            return self._climatology_forecast(day_offset)

    def _validate_real_weather_input(self, farm: Farm, weather_data: Dict, day_offset: int) -> None:
        if farm.latitude is None or farm.longitude is None:
            raise ValueError("Real weather requires farm coordinates. Update farm latitude/longitude.")

        if not isinstance(weather_data, dict) or not weather_data:
            raise ValueError("Real weather data unavailable for forecast.")

        source = str(weather_data.get('source') or '').lower()
        if source in {'climatology', 'fallback'}:
            raise ValueError("Fallback weather data is not allowed. Real forecast data unavailable.")

        required_fields = ['temperature', 'humidity', 'rainfall']
        missing = [field for field in required_fields if weather_data.get(field) is None]
        if missing:
            raise ValueError(
                f"Real weather data missing required fields for day {day_offset}: {', '.join(missing)}."
            )
    
    def _climatology_forecast(self, day_offset: int) -> Dict:
        """Fallback climatology-based forecast"""
        # Simple persistence + trend
        base_temp = 22 + (day_offset * 0.1)  # Slight warming trend
        base_humidity = 75 - (day_offset * 0.5)  # Slight drying
        
        return {
            'temperature': base_temp,
            'humidity': max(40, base_humidity),
            'rainfall': 2.0 if day_offset % 3 == 0 else 0.5,
            'leaf_wetness': 0.6,
            'wind_speed': 3.0,
            'source': 'climatology'
        }
    
    def _calculate_disease_risk(self, disease_name: str, weather_data: Dict) -> Dict:
        """Calculate disease risk from weather data"""
        disease_name_lower = disease_name.lower()
        
        if 'late blight' in disease_name_lower or 'phytophthora' in disease_name_lower:
            return self.disease_engine.predict_late_blight(weather_data)
        elif 'septoria' in disease_name_lower:
            return self.disease_engine.predict_septoria_leaf_spot(weather_data)
        elif 'powdery mildew' in disease_name_lower:
            return self.disease_engine.predict_powdery_mildew(weather_data)
        elif 'bacterial spot' in disease_name_lower:
            return self.disease_engine.predict_bacterial_spot(weather_data)
        elif 'fusarium' in disease_name_lower:
            return self.disease_engine.predict_fusarium_wilt(weather_data)
        else:
            # Generic disease risk
            risk_factors = self.weather_integrator.calculate_disease_risk_factors(weather_data)
            return {
                'disease_name': disease_name,
                'risk_score': risk_factors.get('fungal_risk', 50),
                'risk_level': 'moderate'
            }
    
    def _calculate_forecast_confidence(self, day_offset: int) -> float:
        """
        Calculate forecast confidence based on time horizon
        Decreases with longer forecast period
        """
        if day_offset <= 3:
            return 0.85
        elif day_offset <= 5:
            return 0.75
        else:
            return 0.65
    
    def _calculate_prediction_confidence(
        self, 
        weather_data: Dict, 
        required_params: List[str]
    ) -> float:
        """
        Calculate prediction confidence based on weather data quality
        
        Args:
            weather_data: Weather data dictionary
            required_params: List of required weather parameters
            
        Returns:
            Confidence score (0-100)
        """
        # Base confidence from data source quality
        data_source = weather_data.get('source', 'fallback')
        base_confidence = {
            'local': 95.0,
            'open-meteo': 88.0,
            'openmeteo': 88.0,
            'noaa': 85.0,
            'era5': 82.0,
            'ibm': 75.0,
            'fallback': 60.0,
            'merged': 90.0
        }.get(data_source, 70.0)
        
        # Check data completeness
        missing_params = 0
        default_used = 0
        for param in required_params:
            value = weather_data.get(param)
            if value is None:
                missing_params += 1
            # Check if default value was used (common defaults)
            elif param == 'temperature' and value in [15, 18, 20, 22, 25]:
                default_used += 0.5
            elif param == 'humidity' and value == 70:
                default_used += 0.5
            elif param == 'rainfall' and value == 0:
                default_used += 0.3
        
        # Reduce confidence for missing/default data
        completeness_penalty = (missing_params * 15) + (default_used * 5)
        
        # Final confidence
        confidence = max(40.0, base_confidence - completeness_penalty)
        
        return confidence
    
    def _get_weekly_strategy(self, weekly_risk: str, critical_days: List) -> str:
        """Get recommended weekly disease management strategy"""
        if weekly_risk == "severe":
            return "Immediate preventive fungicide program. Scout daily. Be prepared for multiple applications."
        elif weekly_risk == "high":
            if len(critical_days) >= 3:
                return "Protective fungicide recommended. Scout every 2 days. Monitor weather closely."
            else:
                return "Targeted fungicide application on critical days. Increase scouting frequency."
        elif weekly_risk == "moderate":
            return "Enhanced monitoring. Prepare fungicide. Apply if symptoms appear or risk escalates."
        else:
            return "Routine monitoring sufficient. Maintain good cultural practices."
