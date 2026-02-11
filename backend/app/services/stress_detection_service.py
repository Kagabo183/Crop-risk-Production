"""
Stress Detection Service - Crop stress analysis from satellite and weather data
Implements drought, water, heat, and nutrient stress detection models
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from app.models.data import VegetationHealth, WeatherRecord, SatelliteImage
from app.models.farm import Farm
import logging

logger = logging.getLogger(__name__)


class StressDetectionService:
    """Service for detecting crop stress from satellite and weather data"""
    
    def __init__(self):
        # Stress thresholds
        self.thresholds = {
            'drought': {
                'severe': {'ndvi': 0.3, 'rainfall_deficit': 50, 'ndwi': 0.1},
                'high': {'ndvi': 0.4, 'rainfall_deficit': 30, 'ndwi': 0.2},
                'moderate': {'ndvi': 0.5, 'rainfall_deficit': 15, 'ndwi': 0.3},
                'low': {'ndvi': 0.6, 'rainfall_deficit': 0, 'ndwi': 0.4}
            },
            'water': {
                'severe': {'ndwi': 0.1, 'ndvi_decline_rate': -0.05},
                'high': {'ndwi': 0.15, 'ndvi_decline_rate': -0.03},
                'moderate': {'ndwi': 0.2, 'ndvi_decline_rate': -0.02}
            },
            'heat': {
                'severe': {'temp_days_above_35': 7, 'ndvi_decline_rate': -0.04},
                'high': {'temp_days_above_35': 5, 'ndvi_decline_rate': -0.03},
                'moderate': {'temp_days_above_35': 3, 'ndvi_decline_rate': -0.02}
            },
            'nutrient': {
                'severe': {'ndvi_growth_rate': -0.01, 'ndre': 0.3},
                'high': {'ndvi_growth_rate': 0.0, 'ndre': 0.35},
                'moderate': {'ndvi_growth_rate': 0.01, 'ndre': 0.4}
            }
        }
    
    def detect_drought_stress(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 30
    ) -> Dict:
        """
        Detect drought stress using NDVI, rainfall, and NDWI
        
        Args:
            db: Database session
            farm_id: Farm ID
            days_back: Number of days to analyze
        
        Returns:
            Drought stress assessment dictionary
        """
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        
        # Get vegetation health data
        veg_health = db.query(VegetationHealth).filter(
            and_(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= start_date,
                VegetationHealth.date <= end_date
            )
        ).order_by(VegetationHealth.date.desc()).all()
        
        if not veg_health:
            return {'score': 0, 'level': 'unknown', 'message': 'No vegetation data available'}
        
        # Get latest NDVI and NDWI
        latest = veg_health[0]
        current_ndvi = latest.ndvi or 0
        current_ndwi = latest.ndwi or 0
        
        # Calculate NDVI trend
        if len(veg_health) >= 2:
            ndvi_values = [v.ndvi for v in veg_health if v.ndvi is not None]
            if len(ndvi_values) >= 2:
                ndvi_trend = (ndvi_values[0] - ndvi_values[-1]) / len(ndvi_values)
            else:
                ndvi_trend = 0
        else:
            ndvi_trend = 0
        
        # Get rainfall data
        weather = db.query(WeatherRecord).filter(
            and_(
                WeatherRecord.farm_id == farm_id,
                WeatherRecord.date >= start_date,
                WeatherRecord.date <= end_date
            )
        ).all()
        
        # Calculate rainfall deficit
        if weather:
            total_rainfall = sum([w.rainfall or 0 for w in weather])
            expected_rainfall = days_back * 3  # Assume 3mm/day expected
            rainfall_deficit = max(0, (expected_rainfall - total_rainfall) / expected_rainfall * 100)
        else:
            rainfall_deficit = 0
        
        # Calculate drought score (0-100)
        score = 0
        
        # NDVI contribution (40%)
        if current_ndvi < 0.3:
            score += 40
        elif current_ndvi < 0.4:
            score += 30
        elif current_ndvi < 0.5:
            score += 20
        elif current_ndvi < 0.6:
            score += 10
        
        # Rainfall deficit contribution (30%)
        score += min(30, rainfall_deficit * 0.6)
        
        # NDWI contribution (20%)
        if current_ndwi < 0.1:
            score += 20
        elif current_ndwi < 0.2:
            score += 15
        elif current_ndwi < 0.3:
            score += 10
        
        # NDVI trend contribution (10%)
        if ndvi_trend < -0.05:
            score += 10
        elif ndvi_trend < -0.03:
            score += 7
        elif ndvi_trend < -0.01:
            score += 5
        
        # Determine stress level
        if score >= 75:
            level = 'severe'
        elif score >= 60:
            level = 'high'
        elif score >= 40:
            level = 'moderate'
        elif score >= 20:
            level = 'low'
        else:
            level = 'none'
        
        return {
            'score': round(score, 1),
            'level': level,
            'ndvi': round(current_ndvi, 3),
            'ndwi': round(current_ndwi, 3),
            'rainfall_deficit_percent': round(rainfall_deficit, 1),
            'ndvi_trend': round(ndvi_trend, 4),
            'message': self._get_drought_message(level, score)
        }
    
    def detect_water_stress(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 14
    ) -> Dict:
        """
        Detect water stress using NDWI and NDVI decline rate
        
        Args:
            db: Database session
            farm_id: Farm ID
            days_back: Number of days to analyze
        
        Returns:
            Water stress assessment dictionary
        """
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        
        # Get vegetation health data
        veg_health = db.query(VegetationHealth).filter(
            and_(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= start_date,
                VegetationHealth.date <= end_date
            )
        ).order_by(VegetationHealth.date.desc()).all()
        
        if not veg_health:
            return {'score': 0, 'level': 'unknown', 'message': 'No vegetation data available'}
        
        # Get latest NDWI
        latest = veg_health[0]
        current_ndwi = latest.ndwi or 0
        
        # Calculate NDVI decline rate
        if len(veg_health) >= 2:
            ndvi_values = [v.ndvi for v in veg_health if v.ndvi is not None]
            if len(ndvi_values) >= 2:
                ndvi_decline_rate = (ndvi_values[0] - ndvi_values[-1]) / len(ndvi_values)
            else:
                ndvi_decline_rate = 0
        else:
            ndvi_decline_rate = 0
        
        # Calculate water stress score (0-100)
        score = 0
        
        # NDWI contribution (60%)
        if current_ndwi < 0.1:
            score += 60
        elif current_ndwi < 0.15:
            score += 45
        elif current_ndwi < 0.2:
            score += 30
        elif current_ndwi < 0.25:
            score += 15
        
        # NDVI decline rate contribution (40%)
        if ndvi_decline_rate < -0.05:
            score += 40
        elif ndvi_decline_rate < -0.03:
            score += 30
        elif ndvi_decline_rate < -0.02:
            score += 20
        elif ndvi_decline_rate < -0.01:
            score += 10
        
        # Determine stress level
        if score >= 75:
            level = 'severe'
        elif score >= 60:
            level = 'high'
        elif score >= 40:
            level = 'moderate'
        elif score >= 20:
            level = 'low'
        else:
            level = 'none'
        
        return {
            'score': round(score, 1),
            'level': level,
            'ndwi': round(current_ndwi, 3),
            'ndvi_decline_rate': round(ndvi_decline_rate, 4),
            'message': self._get_water_stress_message(level, score)
        }
    
    def detect_heat_stress(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 14
    ) -> Dict:
        """
        Detect heat stress using temperature extremes and NDVI decline
        
        Args:
            db: Database session
            farm_id: Farm ID
            days_back: Number of days to analyze
        
        Returns:
            Heat stress assessment dictionary
        """
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        
        # Get weather data
        weather = db.query(WeatherRecord).filter(
            and_(
                WeatherRecord.farm_id == farm_id,
                WeatherRecord.date >= start_date,
                WeatherRecord.date <= end_date
            )
        ).all()
        
        # Count heat stress days (temp > 35°C)
        heat_stress_days = sum(1 for w in weather if (w.temperature_max or 0) > 35)
        
        # Get vegetation health data
        veg_health = db.query(VegetationHealth).filter(
            and_(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= start_date,
                VegetationHealth.date <= end_date
            )
        ).order_by(VegetationHealth.date.desc()).all()
        
        # Calculate NDVI decline rate
        ndvi_decline_rate = 0
        if len(veg_health) >= 2:
            ndvi_values = [v.ndvi for v in veg_health if v.ndvi is not None]
            if len(ndvi_values) >= 2:
                ndvi_decline_rate = (ndvi_values[0] - ndvi_values[-1]) / len(ndvi_values)
        
        # Calculate heat stress score (0-100)
        score = 0
        
        # Heat days contribution (60%)
        if heat_stress_days >= 7:
            score += 60
        elif heat_stress_days >= 5:
            score += 45
        elif heat_stress_days >= 3:
            score += 30
        elif heat_stress_days >= 1:
            score += 15
        
        # NDVI decline contribution (40%)
        if ndvi_decline_rate < -0.04:
            score += 40
        elif ndvi_decline_rate < -0.03:
            score += 30
        elif ndvi_decline_rate < -0.02:
            score += 20
        elif ndvi_decline_rate < -0.01:
            score += 10
        
        # Determine stress level
        if score >= 75:
            level = 'severe'
        elif score >= 60:
            level = 'high'
        elif score >= 40:
            level = 'moderate'
        elif score >= 20:
            level = 'low'
        else:
            level = 'none'
        
        return {
            'score': round(score, 1),
            'level': level,
            'heat_stress_days': heat_stress_days,
            'ndvi_decline_rate': round(ndvi_decline_rate, 4),
            'message': self._get_heat_stress_message(level, score, heat_stress_days)
        }
    
    def detect_nutrient_deficiency(
        self,
        db: Session,
        farm_id: int,
        days_back: int = 30
    ) -> Dict:
        """
        Detect nutrient deficiency using NDVI growth rate and NDRE
        
        Args:
            db: Database session
            farm_id: Farm ID
            days_back: Number of days to analyze
        
        Returns:
            Nutrient deficiency assessment dictionary
        """
        end_date = datetime.now().date()
        start_date = end_date - timedelta(days=days_back)
        
        # Get vegetation health data
        veg_health = db.query(VegetationHealth).filter(
            and_(
                VegetationHealth.farm_id == farm_id,
                VegetationHealth.date >= start_date,
                VegetationHealth.date <= end_date
            )
        ).order_by(VegetationHealth.date.desc()).all()
        
        if not veg_health:
            return {'score': 0, 'level': 'unknown', 'message': 'No vegetation data available'}
        
        # Get latest NDRE (sensitive to chlorophyll)
        latest = veg_health[0]
        current_ndre = latest.ndre or 0
        
        # Calculate NDVI growth rate
        if len(veg_health) >= 2:
            ndvi_values = [v.ndvi for v in veg_health if v.ndvi is not None]
            if len(ndvi_values) >= 2:
                ndvi_growth_rate = (ndvi_values[0] - ndvi_values[-1]) / len(ndvi_values)
            else:
                ndvi_growth_rate = 0
        else:
            ndvi_growth_rate = 0
        
        # Calculate nutrient deficiency score (0-100)
        score = 0
        
        # NDRE contribution (50%) - low NDRE indicates chlorophyll deficiency
        if current_ndre < 0.3:
            score += 50
        elif current_ndre < 0.35:
            score += 40
        elif current_ndre < 0.4:
            score += 30
        elif current_ndre < 0.45:
            score += 20
        elif current_ndre < 0.5:
            score += 10
        
        # NDVI growth rate contribution (50%) - negative or slow growth
        if ndvi_growth_rate < -0.01:
            score += 50
        elif ndvi_growth_rate < 0:
            score += 40
        elif ndvi_growth_rate < 0.01:
            score += 30
        elif ndvi_growth_rate < 0.02:
            score += 20
        elif ndvi_growth_rate < 0.03:
            score += 10
        
        # Determine stress level
        if score >= 75:
            level = 'severe'
        elif score >= 60:
            level = 'high'
        elif score >= 40:
            level = 'moderate'
        elif score >= 20:
            level = 'low'
        else:
            level = 'none'
        
        return {
            'score': round(score, 1),
            'level': level,
            'ndre': round(current_ndre, 3),
            'ndvi_growth_rate': round(ndvi_growth_rate, 4),
            'message': self._get_nutrient_message(level, score)
        }
    
    def calculate_composite_health_score(
        self,
        db: Session,
        farm_id: int
    ) -> Dict:
        """
        Calculate composite health score from all stress types
        
        Args:
            db: Database session
            farm_id: Farm ID
        
        Returns:
            Composite health assessment dictionary
        """
        # Get all stress scores
        drought = self.detect_drought_stress(db, farm_id)
        water = self.detect_water_stress(db, farm_id)
        heat = self.detect_heat_stress(db, farm_id)
        nutrient = self.detect_nutrient_deficiency(db, farm_id)
        
        # Weighted combination
        weights = {
            'drought': 0.30,
            'water': 0.25,
            'heat': 0.25,
            'nutrient': 0.20
        }
        
        composite_stress_score = (
            drought['score'] * weights['drought'] +
            water['score'] * weights['water'] +
            heat['score'] * weights['heat'] +
            nutrient['score'] * weights['nutrient']
        )
        
        # Health score is inverse of stress (100 - stress)
        health_score = 100 - composite_stress_score
        
        # Determine primary stress driver
        stress_scores = {
            'drought': drought['score'],
            'water': water['score'],
            'heat': heat['score'],
            'nutrient': nutrient['score']
        }
        primary_stress = max(stress_scores, key=stress_scores.get)
        
        # Determine overall stress level
        if composite_stress_score >= 75:
            stress_level = 'severe'
        elif composite_stress_score >= 60:
            stress_level = 'high'
        elif composite_stress_score >= 40:
            stress_level = 'moderate'
        elif composite_stress_score >= 20:
            stress_level = 'low'
        else:
            stress_level = 'none'
        
        return {
            'health_score': round(health_score, 1),
            'stress_score': round(composite_stress_score, 1),
            'stress_level': stress_level,
            'primary_stress': primary_stress if stress_scores[primary_stress] > 20 else 'none',
            'stress_breakdown': {
                'drought': drought,
                'water': water,
                'heat': heat,
                'nutrient': nutrient
            },
            'message': self._get_composite_message(health_score, stress_level, primary_stress)
        }
    
    def update_vegetation_health_record(
        self,
        db: Session,
        farm_id: int,
        date: datetime.date
    ) -> Optional[VegetationHealth]:
        """
        Update or create vegetation health record with stress assessment
        
        Args:
            db: Database session
            farm_id: Farm ID
            date: Date for the record
        
        Returns:
            Updated VegetationHealth record
        """
        # Get composite health assessment
        assessment = self.calculate_composite_health_score(db, farm_id)
        
        # Get latest satellite data
        sat_image = db.query(SatelliteImage).filter(
            SatelliteImage.farm_id == farm_id,
            SatelliteImage.date == date
        ).first()
        
        if not sat_image:
            logger.warning(f"No satellite data for farm {farm_id} on {date}")
            return None
        
        # Check if record exists
        veg_health = db.query(VegetationHealth).filter(
            VegetationHealth.farm_id == farm_id,
            VegetationHealth.date == date
        ).first()
        
        if veg_health:
            # Update existing record
            veg_health.ndvi = sat_image.mean_ndvi
            veg_health.ndre = sat_image.mean_ndre
            veg_health.ndwi = sat_image.mean_ndwi
            veg_health.evi = sat_image.mean_evi
            veg_health.savi = sat_image.mean_savi
            veg_health.health_score = assessment['health_score']
            veg_health.stress_level = assessment['stress_level']
            veg_health.stress_type = assessment['primary_stress']
        else:
            # Create new record
            veg_health = VegetationHealth(
                farm_id=farm_id,
                date=date,
                ndvi=sat_image.mean_ndvi,
                ndre=sat_image.mean_ndre,
                ndwi=sat_image.mean_ndwi,
                evi=sat_image.mean_evi,
                savi=sat_image.mean_savi,
                health_score=assessment['health_score'],
                stress_level=assessment['stress_level'],
                stress_type=assessment['primary_stress']
            )
            db.add(veg_health)
        
        db.commit()
        db.refresh(veg_health)
        return veg_health
    
    # Helper methods for messages
    def _get_drought_message(self, level: str, score: float) -> str:
        messages = {
            'severe': f'Severe drought stress detected (score: {score:.1f}). Immediate irrigation recommended.',
            'high': f'High drought stress (score: {score:.1f}). Consider irrigation within 24-48 hours.',
            'moderate': f'Moderate drought stress (score: {score:.1f}). Monitor closely and prepare for irrigation.',
            'low': f'Low drought stress (score: {score:.1f}). Continue routine monitoring.',
            'none': f'No significant drought stress (score: {score:.1f}).'
        }
        return messages.get(level, 'Unknown stress level')
    
    def _get_water_stress_message(self, level: str, score: float) -> str:
        messages = {
            'severe': f'Severe water stress detected (score: {score:.1f}). Immediate action required.',
            'high': f'High water stress (score: {score:.1f}). Increase irrigation frequency.',
            'moderate': f'Moderate water stress (score: {score:.1f}). Monitor soil moisture.',
            'low': f'Low water stress (score: {score:.1f}). Normal irrigation schedule.',
            'none': f'No significant water stress (score: {score:.1f}).'
        }
        return messages.get(level, 'Unknown stress level')
    
    def _get_heat_stress_message(self, level: str, score: float, heat_days: int) -> str:
        messages = {
            'severe': f'Severe heat stress ({heat_days} days >35°C, score: {score:.1f}). Provide shade or cooling if possible.',
            'high': f'High heat stress ({heat_days} days >35°C, score: {score:.1f}). Monitor crop closely.',
            'moderate': f'Moderate heat stress ({heat_days} days >35°C, score: {score:.1f}). Watch for heat damage.',
            'low': f'Low heat stress ({heat_days} days >35°C, score: {score:.1f}). Normal monitoring.',
            'none': f'No significant heat stress (score: {score:.1f}).'
        }
        return messages.get(level, 'Unknown stress level')
    
    def _get_nutrient_message(self, level: str, score: float) -> str:
        messages = {
            'severe': f'Severe nutrient deficiency suspected (score: {score:.1f}). Soil testing and fertilization recommended.',
            'high': f'High nutrient deficiency (score: {score:.1f}). Consider fertilizer application.',
            'moderate': f'Moderate nutrient deficiency (score: {score:.1f}). Monitor growth and consider supplementation.',
            'low': f'Low nutrient deficiency (score: {score:.1f}). Routine fertilization schedule.',
            'none': f'No significant nutrient deficiency (score: {score:.1f}).'
        }
        return messages.get(level, 'Unknown stress level')
    
    def _get_composite_message(self, health_score: float, stress_level: str, primary_stress: str) -> str:
        if stress_level == 'severe':
            return f'Farm health: {health_score:.1f}/100 (Severe stress). Primary issue: {primary_stress}. Immediate intervention required.'
        elif stress_level == 'high':
            return f'Farm health: {health_score:.1f}/100 (High stress). Primary issue: {primary_stress}. Action needed within 24-48 hours.'
        elif stress_level == 'moderate':
            return f'Farm health: {health_score:.1f}/100 (Moderate stress). Primary issue: {primary_stress}. Enhanced monitoring recommended.'
        elif stress_level == 'low':
            return f'Farm health: {health_score:.1f}/100 (Low stress). Continue routine management.'
        else:
            return f'Farm health: {health_score:.1f}/100 (Healthy). No significant stress detected.'
