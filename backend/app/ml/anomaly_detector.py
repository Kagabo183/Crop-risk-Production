"""
NDVI Anomaly Detection using Isolation Forest
Detects unusual vegetation health patterns from satellite imagery

Features used:
- NDVI value and temporal patterns
- NDVI deviation from historical mean
- Rate of change (velocity)
- Seasonal adjustment
- Multi-index anomaly (NDVI, NDWI, EVI)
"""
import os
import logging
import pickle
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path
from datetime import datetime, timedelta
import json

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)


class NDVIAnomalyDetector:
    """
    Detects anomalous vegetation patterns using Isolation Forest algorithm.
    Can identify drought stress, disease onset, and other vegetation anomalies.
    """

    def __init__(self, contamination: float = 0.1):
        """
        Initialize the anomaly detector.

        Args:
            contamination: Expected proportion of anomalies in data (0.05-0.2)
        """
        self.model = None
        self.scaler = StandardScaler()
        self.contamination = contamination
        self.is_fitted = False

        # Feature configuration
        self.feature_names = [
            'ndvi',              # Current NDVI value
            'ndvi_deviation',    # Deviation from historical mean
            'ndvi_velocity',     # Rate of change
            'ndwi',              # Water index
            'evi',               # Enhanced vegetation index
            'ndvi_7d_mean',      # 7-day rolling mean
            'ndvi_7d_std',       # 7-day rolling std
            'seasonal_factor'   # Seasonal adjustment
        ]

        # Model paths
        self.model_dir = Path(os.environ.get('MODEL_DIR', '/app/data/models'))
        self.model_path = self.model_dir / "ndvi_anomaly_detector.pkl"
        self.scaler_path = self.model_dir / "ndvi_anomaly_scaler.pkl"

    def _compute_features(self, data: List[Dict]) -> np.ndarray:
        """
        Compute features from raw vegetation data.

        Args:
            data: List of dicts with vegetation indices and metadata

        Returns:
            Feature matrix (n_samples x n_features)
        """
        features = []

        for i, record in enumerate(data):
            # Basic indices
            ndvi = record.get('ndvi', 0.5)
            ndwi = record.get('ndwi', 0.3)
            evi = record.get('evi', 0.4)

            # Historical mean (default to typical healthy value)
            hist_mean = record.get('historical_mean', 0.6)
            ndvi_deviation = ndvi - hist_mean

            # Velocity (rate of change)
            if i > 0:
                prev_ndvi = data[i-1].get('ndvi', ndvi)
                ndvi_velocity = ndvi - prev_ndvi
            else:
                ndvi_velocity = 0.0

            # Rolling statistics (use window if available)
            window_data = data[max(0, i-6):i+1]
            ndvi_values = [d.get('ndvi', 0.5) for d in window_data]
            ndvi_7d_mean = np.mean(ndvi_values)
            ndvi_7d_std = np.std(ndvi_values) if len(ndvi_values) > 1 else 0.0

            # Seasonal factor (adjust expected NDVI by month)
            date = record.get('date')
            if date:
                if isinstance(date, str):
                    date = datetime.fromisoformat(date.replace('Z', '+00:00'))
                month = date.month
                # Rwanda: Two growing seasons, peak vegetation March-May and Sept-Nov
                seasonal_factor = self._get_seasonal_factor(month)
            else:
                seasonal_factor = 1.0

            feature_row = [
                ndvi,
                ndvi_deviation,
                ndvi_velocity,
                ndwi,
                evi,
                ndvi_7d_mean,
                ndvi_7d_std,
                seasonal_factor
            ]

            features.append(feature_row)

        return np.array(features)

    def _get_seasonal_factor(self, month: int) -> float:
        """
        Get seasonal adjustment factor for Rwanda.
        Higher values during growing seasons.
        """
        # Rwanda seasonal calendar:
        # Long rains: March-May (Season A)
        # Short rains: Sept-Nov (Season B)
        # Dry seasons: June-Aug, Dec-Feb
        seasonal_map = {
            1: 0.7,   # Dry
            2: 0.8,   # Dry transitioning
            3: 1.0,   # Rainy - peak growth
            4: 1.0,   # Rainy - peak growth
            5: 0.95,  # End of long rains
            6: 0.7,   # Dry season
            7: 0.65,  # Dry season
            8: 0.7,   # Dry transitioning
            9: 0.9,   # Short rains begin
            10: 1.0,  # Peak growth
            11: 0.95, # End of short rains
            12: 0.75  # Dry season
        }
        return seasonal_map.get(month, 1.0)

    def fit(self, data: List[Dict], **kwargs) -> Dict[str, Any]:
        """
        Train the anomaly detector on historical data.

        Args:
            data: List of vegetation records with indices

        Returns:
            Training metrics
        """
        try:
            # Compute features
            X = self._compute_features(data)

            if len(X) < 10:
                logger.warning("Insufficient data for training (need at least 10 samples)")
                return {'error': 'Insufficient data', 'samples': len(X)}

            # Scale features
            X_scaled = self.scaler.fit_transform(X)

            # Initialize and fit Isolation Forest
            self.model = IsolationForest(
                n_estimators=kwargs.get('n_estimators', 100),
                contamination=self.contamination,
                max_samples='auto',
                random_state=42,
                n_jobs=-1
            )

            self.model.fit(X_scaled)
            self.is_fitted = True

            # Compute baseline scores
            scores = self.model.decision_function(X_scaled)
            predictions = self.model.predict(X_scaled)

            # Statistics
            n_anomalies = (predictions == -1).sum()

            logger.info(f"Anomaly detector trained on {len(X)} samples, "
                       f"detected {n_anomalies} baseline anomalies")

            return {
                'samples_trained': len(X),
                'anomalies_detected': int(n_anomalies),
                'anomaly_rate': float(n_anomalies / len(X)),
                'score_mean': float(np.mean(scores)),
                'score_std': float(np.std(scores)),
                'contamination': self.contamination,
                'features': self.feature_names
            }

        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'error': str(e)}

    def detect(self, data: List[Dict]) -> List[Dict[str, Any]]:
        """
        Detect anomalies in vegetation data.

        Args:
            data: List of vegetation records to analyze

        Returns:
            List of results with anomaly scores and flags
        """
        if not self.is_fitted:
            # Try to load saved model
            if not self.load():
                logger.warning("Model not fitted, using default thresholds")
                return self._detect_heuristic(data)

        try:
            # Compute features
            X = self._compute_features(data)
            X_scaled = self.scaler.transform(X)

            # Get anomaly scores and predictions
            scores = self.model.decision_function(X_scaled)
            predictions = self.model.predict(X_scaled)

            results = []
            for i, record in enumerate(data):
                is_anomaly = predictions[i] == -1
                anomaly_score = -scores[i]  # Higher = more anomalous

                # Determine anomaly type if detected
                anomaly_type = None
                if is_anomaly:
                    anomaly_type = self._classify_anomaly_type(X[i], record)

                result = {
                    'date': record.get('date'),
                    'farm_id': record.get('farm_id'),
                    'is_anomaly': bool(is_anomaly),
                    'anomaly_score': round(float(anomaly_score), 4),
                    'anomaly_type': anomaly_type,
                    'ndvi': record.get('ndvi'),
                    'severity': self._get_severity(anomaly_score) if is_anomaly else 'normal',
                    'features': {
                        name: float(X[i][j])
                        for j, name in enumerate(self.feature_names)
                    }
                }

                # Add recommendations if anomaly
                if is_anomaly:
                    result['recommendations'] = self._get_recommendations(anomaly_type, anomaly_score)

                results.append(result)

            return results

        except Exception as e:
            logger.error(f"Detection failed: {e}")
            return self._detect_heuristic(data)

    def _detect_heuristic(self, data: List[Dict]) -> List[Dict[str, Any]]:
        """
        Fallback heuristic-based anomaly detection.
        Uses simple statistical thresholds.
        """
        results = []

        # Compute statistics from data
        ndvi_values = [d.get('ndvi', 0.5) for d in data]
        mean_ndvi = np.mean(ndvi_values)
        std_ndvi = np.std(ndvi_values) if len(ndvi_values) > 1 else 0.1

        for i, record in enumerate(data):
            ndvi = record.get('ndvi', 0.5)

            # Z-score based anomaly
            z_score = (ndvi - mean_ndvi) / std_ndvi if std_ndvi > 0 else 0
            is_anomaly = abs(z_score) > 2.0  # 2 standard deviations

            # Simple anomaly score
            anomaly_score = abs(z_score) / 3.0  # Normalize to ~0-1

            anomaly_type = None
            if is_anomaly:
                if ndvi < mean_ndvi - 2 * std_ndvi:
                    anomaly_type = 'severe_decline'
                elif ndvi < mean_ndvi - std_ndvi:
                    anomaly_type = 'moderate_decline'
                else:
                    anomaly_type = 'unusual_increase'

            results.append({
                'date': record.get('date'),
                'farm_id': record.get('farm_id'),
                'is_anomaly': bool(is_anomaly),
                'anomaly_score': round(float(anomaly_score), 4),
                'anomaly_type': anomaly_type,
                'ndvi': ndvi,
                'severity': self._get_severity(anomaly_score) if is_anomaly else 'normal',
                'method': 'heuristic'
            })

        return results

    def _classify_anomaly_type(self, features: np.ndarray, record: Dict) -> str:
        """
        Classify the type of anomaly based on feature patterns.
        """
        ndvi = features[0]
        ndvi_deviation = features[1]
        ndvi_velocity = features[2]
        ndwi = features[3]

        # Rapid decline - possible disease or pest
        if ndvi_velocity < -0.05 and ndvi < 0.4:
            return 'rapid_decline'

        # Water stress - low NDWI with declining NDVI
        if ndwi < 0.2 and ndvi_deviation < -0.1:
            return 'water_stress'

        # Drought stress - prolonged low values
        if ndvi < 0.3 and ndvi_deviation < -0.2:
            return 'drought_stress'

        # Unusual growth - higher than expected
        if ndvi_deviation > 0.15:
            return 'unusual_growth'

        # General vegetation stress
        if ndvi_deviation < -0.1:
            return 'vegetation_stress'

        return 'unknown_anomaly'

    def _get_severity(self, anomaly_score: float) -> str:
        """Map anomaly score to severity level"""
        if anomaly_score > 0.8:
            return 'critical'
        elif anomaly_score > 0.6:
            return 'severe'
        elif anomaly_score > 0.4:
            return 'moderate'
        elif anomaly_score > 0.2:
            return 'mild'
        else:
            return 'low'

    def _get_recommendations(self, anomaly_type: str, score: float) -> List[str]:
        """Get recommendations based on anomaly type"""
        recommendations_map = {
            'rapid_decline': [
                'Immediate field inspection recommended',
                'Check for pest or disease signs',
                'Review recent weather events'
            ],
            'water_stress': [
                'Consider supplemental irrigation',
                'Check soil moisture levels',
                'Monitor rainfall forecast'
            ],
            'drought_stress': [
                'Implement water conservation measures',
                'Apply mulching to retain moisture',
                'Consider drought-resistant varieties for next season'
            ],
            'vegetation_stress': [
                'Monitor closely for next 7 days',
                'Check nutrient levels',
                'Review pest and disease history'
            ],
            'unusual_growth': [
                'Verify satellite data accuracy',
                'Check for potential errors in data',
                'Compare with neighboring farms'
            ]
        }

        base_recs = recommendations_map.get(anomaly_type, ['Schedule field inspection'])

        if score > 0.7:
            base_recs.insert(0, 'URGENT: High severity anomaly detected')

        return base_recs

    def save(self, path: Optional[str] = None) -> str:
        """Save model and scaler to disk"""
        try:
            save_path = Path(path) if path else self.model_path
            save_path.parent.mkdir(parents=True, exist_ok=True)

            # Save model
            with open(save_path, 'wb') as f:
                pickle.dump(self.model, f)

            # Save scaler
            scaler_path = save_path.with_name(save_path.stem + '_scaler.pkl')
            with open(scaler_path, 'wb') as f:
                pickle.dump(self.scaler, f)

            # Save metadata
            meta_path = save_path.with_suffix('.json')
            with open(meta_path, 'w') as f:
                json.dump({
                    'contamination': self.contamination,
                    'features': self.feature_names,
                    'saved_at': datetime.utcnow().isoformat()
                }, f)

            logger.info(f"Anomaly detector saved to {save_path}")
            return str(save_path)

        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            return ""

    def load(self, path: Optional[str] = None) -> bool:
        """Load model and scaler from disk"""
        try:
            load_path = Path(path) if path else self.model_path

            if not load_path.exists():
                logger.warning(f"Model file not found: {load_path}")
                return False

            # Load model
            with open(load_path, 'rb') as f:
                self.model = pickle.load(f)

            # Load scaler
            scaler_path = load_path.with_name(load_path.stem + '_scaler.pkl')
            if scaler_path.exists():
                with open(scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)

            self.is_fitted = True
            logger.info(f"Anomaly detector loaded from {load_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False

    def get_threshold_analysis(self, data: List[Dict]) -> Dict[str, Any]:
        """
        Analyze data to recommend optimal contamination threshold.
        """
        if len(data) < 20:
            return {'error': 'Need at least 20 samples for analysis'}

        X = self._compute_features(data)
        X_scaled = self.scaler.fit_transform(X)

        # Test different contamination levels
        results = {}
        for cont in [0.05, 0.1, 0.15, 0.2]:
            model = IsolationForest(contamination=cont, random_state=42)
            model.fit(X_scaled)
            preds = model.predict(X_scaled)
            n_anomalies = (preds == -1).sum()

            results[f'cont_{cont}'] = {
                'anomalies': int(n_anomalies),
                'rate': float(n_anomalies / len(X))
            }

        return {
            'samples': len(X),
            'analysis': results,
            'recommendation': 'Use 0.1 for normal conditions, 0.15 for high-risk areas'
        }
