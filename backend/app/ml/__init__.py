"""
Machine Learning Module for Crop Risk Prediction Platform

This module provides AI/ML capabilities combined with research-validated algorithms:

Models:
1. DiseaseClassifier (CNN) - 80-class plant disease detection (30 plants, 56 diseases)
   Trained on PlantVillage + Mendeley dataset using EfficientNet-B0
2. NDVIAnomalyDetector (Isolation Forest) - Detects unusual vegetation patterns
3. YieldPredictor (XGBoost) - Predicts crop yield based on conditions
4. HealthTrendForecaster (Prophet) - Time-series forecasting for vegetation health
5. EnsembleRiskScorer - Combines all models with research algorithms

Research-Validated Algorithms:
- Smith Period Model (Cornell) - Late Blight prediction
- TOM-CAST DSV (Ohio State) - Septoria leaf spot
- SIMCAST - Early Blight prediction
- BLITECAST - Potato Late Blight

Usage:
    from app.ml import DiseaseClassifier, EnsembleRiskScorer

    # Classify disease from image (all 80 classes)
    classifier = DiseaseClassifier()
    result = classifier.predict('path/to/leaf_image.jpg')

    # Classify with crop filter
    classifier = DiseaseClassifier(crop_type='potato')
    result = classifier.predict('path/to/leaf_image.jpg')

    # Get comprehensive risk assessment
    scorer = EnsembleRiskScorer()
    risk = scorer.calculate_risk(farm_data)
"""

from app.ml.disease_classifier import DiseaseClassifier
from app.ml.anomaly_detector import NDVIAnomalyDetector
from app.ml.yield_predictor import YieldPredictor
from app.ml.trend_forecaster import HealthTrendForecaster
from app.ml.ensemble_scorer import EnsembleRiskScorer
from app.ml.model_registry import ModelRegistry, get_registry
from app.ml.intelligence import RiskIntelligence, SpatialAnalyzer

__all__ = [
    # ML Models
    'DiseaseClassifier',
    'NDVIAnomalyDetector',
    'YieldPredictor',
    'HealthTrendForecaster',
    'EnsembleRiskScorer',

    # Registry
    'ModelRegistry',
    'get_registry',

    # Intelligence utilities
    'RiskIntelligence',
    'SpatialAnalyzer'
]

__version__ = '1.0.0'
