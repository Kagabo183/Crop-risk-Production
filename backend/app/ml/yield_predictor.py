"""
Yield Prediction using XGBoost
Predicts crop yield based on vegetation health, weather, and historical data

Features:
- Vegetation indices (NDVI, EVI, NDWI trends)
- Weather conditions (temperature, rainfall, humidity)
- Historical yields
- Growing season stage
- Soil quality indicators
"""
import os
import logging
import pickle
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
from datetime import datetime
import json

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, cross_val_score

logger = logging.getLogger(__name__)

# Crop yield benchmarks (tons/hectare for Rwanda)
CROP_YIELD_BENCHMARKS = {
    'potato': {'low': 5.0, 'average': 12.0, 'high': 20.0, 'potential': 25.0},
    'tomato': {'low': 8.0, 'average': 25.0, 'high': 40.0, 'potential': 60.0},
    'maize': {'low': 1.0, 'average': 2.5, 'high': 4.0, 'potential': 6.0},
    'bean': {'low': 0.5, 'average': 1.2, 'high': 2.0, 'potential': 3.0},
    'rice': {'low': 2.0, 'average': 4.5, 'high': 7.0, 'potential': 10.0},
    'wheat': {'low': 1.5, 'average': 3.0, 'high': 4.5, 'potential': 6.0}
}


class YieldPredictor:
    """
    XGBoost-based crop yield predictor.
    Combines satellite imagery analysis with weather data for yield estimation.
    """

    def __init__(self, crop_type: str = 'potato'):
        """
        Initialize the yield predictor.

        Args:
            crop_type: Type of crop for prediction
        """
        self.crop_type = crop_type.lower()
        self.model = None
        self.scaler = StandardScaler()
        self.is_fitted = False

        # Feature names
        self.feature_names = [
            # Vegetation features
            'ndvi_mean',
            'ndvi_max',
            'ndvi_trend',
            'evi_mean',
            'ndwi_mean',
            'vegetation_health_score',

            # Weather features
            'temp_mean',
            'temp_max',
            'temp_min',
            'rainfall_total',
            'rainfall_days',
            'humidity_mean',
            'gdd',  # Growing degree days

            # Farm features
            'farm_area_ha',
            'elevation',
            'growing_season_days',

            # Historical features
            'historical_yield_mean',
            'yield_trend'
        ]

        # Model paths
        self.model_dir = Path(os.environ.get('MODEL_DIR', '/app/data/models'))
        self.model_path = self.model_dir / f"yield_predictor_{self.crop_type}.pkl"

        # Crop benchmarks
        self.benchmarks = CROP_YIELD_BENCHMARKS.get(
            self.crop_type,
            CROP_YIELD_BENCHMARKS['potato']
        )

    def _compute_features(self, farm_data: Dict) -> np.ndarray:
        """
        Compute features from farm data.

        Args:
            farm_data: Dictionary with vegetation, weather, and farm info

        Returns:
            Feature vector
        """
        # Vegetation features
        veg = farm_data.get('vegetation', {})
        ndvi_mean = veg.get('ndvi_mean', 0.5)
        ndvi_max = veg.get('ndvi_max', 0.6)
        ndvi_trend = veg.get('ndvi_trend', 0.0)
        evi_mean = veg.get('evi_mean', 0.4)
        ndwi_mean = veg.get('ndwi_mean', 0.3)
        vegetation_health_score = veg.get('health_score', 70.0)

        # Weather features
        weather = farm_data.get('weather', {})
        temp_mean = weather.get('temp_mean', 20.0)
        temp_max = weather.get('temp_max', 25.0)
        temp_min = weather.get('temp_min', 15.0)
        rainfall_total = weather.get('rainfall_total', 100.0)
        rainfall_days = weather.get('rainfall_days', 10)
        humidity_mean = weather.get('humidity_mean', 70.0)

        # Growing degree days (GDD) calculation
        base_temp = self._get_base_temperature()
        gdd = max(0, (temp_mean - base_temp)) * farm_data.get('growing_season_days', 90)

        # Farm features
        farm = farm_data.get('farm', {})
        farm_area_ha = farm.get('area', 1.0)
        elevation = farm.get('elevation', 1500)
        growing_season_days = farm_data.get('growing_season_days', 90)

        # Historical features
        historical = farm_data.get('historical', {})
        historical_yield_mean = historical.get('yield_mean', self.benchmarks['average'])
        yield_trend = historical.get('yield_trend', 0.0)

        features = [
            ndvi_mean, ndvi_max, ndvi_trend, evi_mean, ndwi_mean, vegetation_health_score,
            temp_mean, temp_max, temp_min, rainfall_total, rainfall_days, humidity_mean, gdd,
            farm_area_ha, elevation, growing_season_days,
            historical_yield_mean, yield_trend
        ]

        return np.array(features).reshape(1, -1)

    def _get_base_temperature(self) -> float:
        """Get base temperature for GDD calculation by crop type"""
        base_temps = {
            'potato': 7.0,
            'tomato': 10.0,
            'maize': 10.0,
            'bean': 10.0,
            'rice': 10.0,
            'wheat': 4.0
        }
        return base_temps.get(self.crop_type, 10.0)

    def train(self, training_data: List[Dict], **kwargs) -> Dict[str, Any]:
        """
        Train the yield prediction model.

        Args:
            training_data: List of historical farm data with actual yields
            **kwargs: Additional XGBoost parameters

        Returns:
            Training metrics
        """
        try:
            import xgboost as xgb

            # Prepare training data
            X_list = []
            y_list = []

            for record in training_data:
                features = self._compute_features(record)
                X_list.append(features.flatten())
                y_list.append(record.get('actual_yield', self.benchmarks['average']))

            X = np.array(X_list)
            y = np.array(y_list)

            if len(X) < 10:
                logger.warning("Insufficient training data")
                return {'error': 'Need at least 10 samples'}

            # Scale features
            X_scaled = self.scaler.fit_transform(X)

            # Split data
            X_train, X_test, y_train, y_test = train_test_split(
                X_scaled, y, test_size=0.2, random_state=42
            )

            # Initialize XGBoost regressor
            self.model = xgb.XGBRegressor(
                n_estimators=kwargs.get('n_estimators', 100),
                max_depth=kwargs.get('max_depth', 6),
                learning_rate=kwargs.get('learning_rate', 0.1),
                subsample=kwargs.get('subsample', 0.8),
                colsample_bytree=kwargs.get('colsample_bytree', 0.8),
                objective='reg:squarederror',
                random_state=42,
                n_jobs=-1
            )

            # Train
            self.model.fit(
                X_train, y_train,
                eval_set=[(X_test, y_test)],
                verbose=False
            )

            self.is_fitted = True

            # Evaluate
            y_pred = self.model.predict(X_test)
            from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

            mse = mean_squared_error(y_test, y_pred)
            mae = mean_absolute_error(y_test, y_pred)
            r2 = r2_score(y_test, y_pred)
            rmse = np.sqrt(mse)

            # Cross-validation
            cv_scores = cross_val_score(self.model, X_scaled, y, cv=5, scoring='r2')

            # Feature importance
            importance = dict(zip(self.feature_names, self.model.feature_importances_))
            sorted_importance = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))

            logger.info(f"Yield predictor trained: R²={r2:.4f}, RMSE={rmse:.4f}")

            return {
                'samples_trained': len(X),
                'metrics': {
                    'r2': float(r2),
                    'rmse': float(rmse),
                    'mae': float(mae),
                    'cv_r2_mean': float(cv_scores.mean()),
                    'cv_r2_std': float(cv_scores.std())
                },
                'feature_importance': sorted_importance,
                'crop_type': self.crop_type
            }

        except ImportError:
            logger.error("XGBoost not installed")
            return {'error': 'XGBoost not installed'}
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'error': str(e)}

    def predict(self, farm_data: Dict) -> Dict[str, Any]:
        """
        Predict crop yield for a farm.

        Args:
            farm_data: Dictionary with vegetation, weather, and farm info

        Returns:
            Yield prediction with confidence intervals
        """
        if not self.is_fitted:
            if not self.load():
                logger.warning("Model not fitted, using heuristic estimation")
                return self._heuristic_prediction(farm_data)

        try:
            # Compute features
            X = self._compute_features(farm_data)
            X_scaled = self.scaler.transform(X)

            # Predict
            predicted_yield = self.model.predict(X_scaled)[0]

            # Get prediction interval using quantile regression (approximation)
            # In production, train quantile forests for proper intervals
            std_estimate = predicted_yield * 0.15  # 15% standard deviation
            lower_bound = max(0, predicted_yield - 1.96 * std_estimate)
            upper_bound = predicted_yield + 1.96 * std_estimate

            # Yield classification
            yield_class = self._classify_yield(predicted_yield)

            # Calculate yield loss risk
            potential = self.benchmarks['potential']
            yield_loss_pct = max(0, (potential - predicted_yield) / potential * 100)

            # Feature contributions (SHAP-like approximation)
            contributions = self._estimate_contributions(X[0])

            return {
                'predicted_yield_tons_ha': round(float(predicted_yield), 2),
                'lower_bound': round(float(lower_bound), 2),
                'upper_bound': round(float(upper_bound), 2),
                'confidence': 0.85,  # Model confidence
                'yield_class': yield_class,
                'yield_loss_percent': round(float(yield_loss_pct), 1),
                'benchmarks': self.benchmarks,
                'crop_type': self.crop_type,
                'farm_area_ha': farm_data.get('farm', {}).get('area', 1.0),
                'total_yield_tons': round(
                    float(predicted_yield * farm_data.get('farm', {}).get('area', 1.0)), 2
                ),
                'contributions': contributions,
                'recommendations': self._get_recommendations(yield_class, contributions)
            }

        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return self._heuristic_prediction(farm_data)

    def _heuristic_prediction(self, farm_data: Dict) -> Dict[str, Any]:
        """
        Fallback heuristic-based yield estimation.
        Uses vegetation health and weather to estimate yield.
        """
        veg = farm_data.get('vegetation', {})
        weather = farm_data.get('weather', {})

        # Base yield from NDVI
        ndvi_mean = veg.get('ndvi_mean', 0.5)
        health_score = veg.get('health_score', 70.0)

        # NDVI to yield ratio (simplified model)
        if ndvi_mean >= 0.7:
            yield_ratio = 0.9
        elif ndvi_mean >= 0.5:
            yield_ratio = 0.7
        elif ndvi_mean >= 0.3:
            yield_ratio = 0.5
        else:
            yield_ratio = 0.3

        # Weather adjustment
        rainfall = weather.get('rainfall_total', 100)
        if rainfall < 50:
            yield_ratio *= 0.7  # Drought penalty
        elif rainfall > 300:
            yield_ratio *= 0.85  # Flood penalty

        predicted_yield = self.benchmarks['potential'] * yield_ratio

        return {
            'predicted_yield_tons_ha': round(float(predicted_yield), 2),
            'lower_bound': round(float(predicted_yield * 0.7), 2),
            'upper_bound': round(float(predicted_yield * 1.3), 2),
            'confidence': 0.5,  # Lower confidence for heuristic
            'yield_class': self._classify_yield(predicted_yield),
            'crop_type': self.crop_type,
            'method': 'heuristic',
            'note': 'Model not trained - using vegetation-based estimation'
        }

    def _classify_yield(self, yield_value: float) -> str:
        """Classify yield into categories"""
        if yield_value >= self.benchmarks['high']:
            return 'excellent'
        elif yield_value >= self.benchmarks['average']:
            return 'good'
        elif yield_value >= self.benchmarks['low']:
            return 'below_average'
        else:
            return 'poor'

    def _estimate_contributions(self, features: np.ndarray) -> Dict[str, float]:
        """
        Estimate feature contributions to prediction.
        Simplified SHAP-like explanation.
        """
        if self.model is None:
            return {}

        importance = self.model.feature_importances_

        # Normalize features
        mean_features = np.mean(features)
        contributions = {}

        for i, (name, imp) in enumerate(zip(self.feature_names, importance)):
            # Contribution = importance * (feature - mean) / mean
            deviation = (features[i] - mean_features) / (mean_features + 1e-6)
            contributions[name] = float(imp * deviation)

        # Sort by absolute contribution
        sorted_contrib = dict(sorted(
            contributions.items(),
            key=lambda x: abs(x[1]),
            reverse=True
        )[:5])  # Top 5 contributors

        return sorted_contrib

    def _get_recommendations(self, yield_class: str, contributions: Dict) -> List[str]:
        """Generate recommendations based on prediction"""
        recommendations = []

        if yield_class in ['poor', 'below_average']:
            recommendations.append('Yield below expectations - investigate limiting factors')

            # Check major negative contributors
            for feature, contrib in contributions.items():
                if contrib < -0.1:
                    if 'rainfall' in feature:
                        recommendations.append('Consider supplemental irrigation')
                    elif 'ndvi' in feature:
                        recommendations.append('Investigate vegetation stress causes')
                    elif 'temp' in feature:
                        recommendations.append('Monitor temperature stress')

        if yield_class == 'excellent':
            recommendations.append('Excellent yield potential - maintain current practices')

        if not recommendations:
            recommendations.append('Continue monitoring and standard practices')

        return recommendations

    def predict_batch(self, farms_data: List[Dict]) -> List[Dict[str, Any]]:
        """
        Predict yields for multiple farms.

        Args:
            farms_data: List of farm data dictionaries

        Returns:
            List of predictions
        """
        results = []
        for farm_data in farms_data:
            result = self.predict(farm_data)
            result['farm_id'] = farm_data.get('farm', {}).get('id')
            results.append(result)
        return results

    def save(self, path: Optional[str] = None) -> str:
        """Save model to disk"""
        try:
            save_path = Path(path) if path else self.model_path
            save_path.parent.mkdir(parents=True, exist_ok=True)

            # Save model
            with open(save_path, 'wb') as f:
                pickle.dump({
                    'model': self.model,
                    'scaler': self.scaler,
                    'crop_type': self.crop_type,
                    'feature_names': self.feature_names
                }, f)

            # Save metadata
            meta_path = save_path.with_suffix('.json')
            with open(meta_path, 'w') as f:
                json.dump({
                    'crop_type': self.crop_type,
                    'features': self.feature_names,
                    'benchmarks': self.benchmarks,
                    'saved_at': datetime.utcnow().isoformat()
                }, f)

            logger.info(f"Yield predictor saved to {save_path}")
            return str(save_path)

        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return ""

    def load(self, path: Optional[str] = None) -> bool:
        """Load model from disk"""
        try:
            load_path = Path(path) if path else self.model_path

            if not load_path.exists():
                logger.warning(f"Model file not found: {load_path}")
                return False

            with open(load_path, 'rb') as f:
                data = pickle.load(f)
                self.model = data['model']
                self.scaler = data['scaler']
                if 'feature_names' in data:
                    self.feature_names = data['feature_names']

            self.is_fitted = True
            logger.info(f"Yield predictor loaded from {load_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False
