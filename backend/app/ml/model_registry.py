"""
Model Registry
Centralized management of ML models with versioning, loading, and health monitoring
"""
import os
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path
from datetime import datetime
import json

logger = logging.getLogger(__name__)

# Model directory
MODEL_DIR = Path(os.environ.get('MODEL_DIR', '/app/data/models'))


class ModelRegistry:
    """
    Central registry for all ML models.
    Provides model versioning, loading, and health monitoring.
    """

    # Registered model types
    MODEL_TYPES = {
        'disease_classifier': {
            'class': 'DiseaseClassifier',
            'module': 'app.ml.disease_classifier',
            'description': 'CNN-based plant disease classification (80 classes, 30 plants)'
        },
        # Per-crop disease classifiers (Rwanda priority crops)
        'disease_classifier_tomato': {
            'class': 'CropDiseaseClassifier',
            'module': 'app.ml.crop_disease_classifier',
            'description': 'Tomato disease classifier (10 classes)',
            'crop_key': 'tomato',
        },
        'disease_classifier_coffee': {
            'class': 'CropDiseaseClassifier',
            'module': 'app.ml.crop_disease_classifier',
            'description': 'Coffee disease classifier (3 classes)',
            'crop_key': 'coffee',
        },
        'disease_classifier_pepper': {
            'class': 'CropDiseaseClassifier',
            'module': 'app.ml.crop_disease_classifier',
            'description': 'Chilli/Pepper disease classifier (2 classes)',
            'crop_key': 'pepper',
        },
        'disease_classifier_potato': {
            'class': 'CropDiseaseClassifier',
            'module': 'app.ml.crop_disease_classifier',
            'description': 'Potato disease classifier (3 classes)',
            'crop_key': 'potato',
        },
        'disease_classifier_cassava': {
            'class': 'CropDiseaseClassifier',
            'module': 'app.ml.crop_disease_classifier',
            'description': 'Cassava disease classifier (5 classes)',
            'crop_key': 'cassava',
        },
        'anomaly_detector': {
            'class': 'NDVIAnomalyDetector',
            'module': 'app.ml.anomaly_detector',
            'description': 'Isolation Forest for vegetation anomaly detection'
        },
        'yield_predictor': {
            'class': 'YieldPredictor',
            'module': 'app.ml.yield_predictor',
            'description': 'XGBoost-based crop yield prediction'
        },
        'trend_forecaster': {
            'class': 'HealthTrendForecaster',
            'module': 'app.ml.trend_forecaster',
            'description': 'Prophet-based health trend forecasting'
        },
        'ensemble_scorer': {
            'class': 'EnsembleRiskScorer',
            'module': 'app.ml.ensemble_scorer',
            'description': 'Ensemble risk assessment combining all models'
        }
    }

    def __init__(self):
        self._models: Dict[str, Any] = {}
        self._model_info: Dict[str, Dict] = {}
        self._ensure_model_dir()

    def _ensure_model_dir(self):
        """Ensure model directory exists"""
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

    def register_model(self, model_type: str, model_instance: Any,
                       version: str = "1.0.0", metadata: Optional[Dict] = None) -> bool:
        """
        Register a model instance.

        Args:
            model_type: Type of model (from MODEL_TYPES)
            model_instance: The model object
            version: Version string
            metadata: Additional metadata

        Returns:
            True if registration successful
        """
        if model_type not in self.MODEL_TYPES:
            logger.warning(f"Unknown model type: {model_type}")

        key = f"{model_type}:{version}"
        self._models[key] = model_instance
        self._model_info[key] = {
            'type': model_type,
            'version': version,
            'registered_at': datetime.utcnow().isoformat(),
            'metadata': metadata or {}
        }

        logger.info(f"Registered model: {key}")
        return True

    def get_model(self, model_type: str, version: Optional[str] = None) -> Optional[Any]:
        """
        Get a registered model.

        Args:
            model_type: Type of model
            version: Specific version (default: latest)

        Returns:
            Model instance or None
        """
        if version:
            key = f"{model_type}:{version}"
            return self._models.get(key)

        # Find latest version
        matching = [k for k in self._models.keys() if k.startswith(f"{model_type}:")]
        if matching:
            latest = sorted(matching)[-1]
            return self._models.get(latest)

        # Try to load model dynamically
        return self._load_model(model_type)

    def _load_model(self, model_type: str) -> Optional[Any]:
        """
        Dynamically load a model.

        Args:
            model_type: Type of model to load

        Returns:
            Loaded model instance or None
        """
        if model_type not in self.MODEL_TYPES:
            logger.error(f"Unknown model type: {model_type}")
            return None

        try:
            config = self.MODEL_TYPES[model_type]
            module = __import__(config['module'], fromlist=[config['class']])
            model_class = getattr(module, config['class'])

            # Per-crop classifiers need a CropDiseaseConfig
            if 'crop_key' in config:
                from app.ml.crop_disease_config import get_crop_config
                crop_config = get_crop_config(config['crop_key'])
                instance = model_class(config=crop_config)
            else:
                instance = model_class()

            # Try to load saved weights
            if hasattr(instance, 'load_model'):
                instance.load_model()
            elif hasattr(instance, 'load'):
                instance.load()

            # Register
            self.register_model(model_type, instance)

            return instance

        except Exception as e:
            logger.error(f"Failed to load model {model_type}: {e}")
            return None

    def load_all_models(self) -> Dict[str, bool]:
        """
        Load all registered model types.

        Returns:
            Dictionary of model_type: load_success
        """
        results = {}
        for model_type in self.MODEL_TYPES.keys():
            try:
                model = self._load_model(model_type)
                results[model_type] = model is not None
            except Exception as e:
                logger.error(f"Failed to load {model_type}: {e}")
                results[model_type] = False

        return results

    def get_model_info(self, model_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Get information about registered models.

        Args:
            model_type: Specific model type (optional)

        Returns:
            Model information dictionary
        """
        if model_type:
            # Find all versions of this model type
            matching = {k: v for k, v in self._model_info.items()
                       if v['type'] == model_type}
            return matching

        return self._model_info

    def list_available_models(self) -> List[Dict[str, str]]:
        """
        List all available model types.

        Returns:
            List of model type information
        """
        return [
            {
                'type': model_type,
                'description': config['description'],
                'class': config['class'],
                'loaded': any(k.startswith(f"{model_type}:") for k in self._models)
            }
            for model_type, config in self.MODEL_TYPES.items()
        ]

    def list_saved_models(self) -> List[Dict[str, Any]]:
        """
        List all saved model files.

        Returns:
            List of saved model information
        """
        models = []

        for file_path in MODEL_DIR.glob("*.pkl"):
            meta_path = file_path.with_suffix('.json')
            metadata = {}

            if meta_path.exists():
                try:
                    with open(meta_path, 'r') as f:
                        metadata = json.load(f)
                except Exception:
                    pass

            models.append({
                'file': file_path.name,
                'path': str(file_path),
                'size_mb': round(file_path.stat().st_size / 1024 / 1024, 2),
                'modified': datetime.fromtimestamp(
                    file_path.stat().st_mtime
                ).isoformat(),
                'metadata': metadata
            })

        return models

    def health_check(self) -> Dict[str, Any]:
        """
        Check health status of all models.

        Returns:
            Health status dictionary with accurate model capabilities
        """
        # Models that can work with defaults (no training required)
        DEFAULT_CAPABLE = {
            'anomaly_detector',  # Uses Isolation Forest with default params
            'yield_predictor',   # Has default crop yield estimates
            'trend_forecaster',  # Prophet uses built-in seasonality
            'ensemble_scorer'    # Combines other models with research algorithms
        }
        
        status = {
            'overall': 'healthy',
            'models': {},
            'model_dir': str(MODEL_DIR),
            'model_dir_exists': MODEL_DIR.exists(),
            'timestamp': datetime.utcnow().isoformat()
        }

        ready_count = 0
        warnings = []

        for model_type, config in self.MODEL_TYPES.items():
            model_status = {
                'loaded': False,
                'has_saved_weights': False,
                'description': config['description']
            }

            # Check if loaded
            loaded = any(k.startswith(f"{model_type}:") for k in self._models)
            model_status['loaded'] = loaded

            # Check for saved weights (.pkl for sklearn/xgboost, .pth for PyTorch)
            saved_files = list(MODEL_DIR.glob(f"{model_type}*.pkl")) + \
                          list(MODEL_DIR.glob(f"{model_type}*.pth"))
            model_status['has_saved_weights'] = len(saved_files) > 0
            model_status['saved_files'] = [f.name for f in saved_files]

            # Determine real status based on capabilities
            if loaded:
                model_status['status'] = 'ready'
                model_status['trained'] = saved_files  # Shows if using custom weights
                ready_count += 1
            elif saved_files:
                model_status['status'] = 'available'
                model_status['trained'] = True
                ready_count += 1
            elif model_type in DEFAULT_CAPABLE:
                # Model works with defaults, but not trained on user data
                model_status['status'] = 'ready'
                model_status['trained'] = False
                model_status['note'] = 'Using default parameters (not trained on your data)'
                warnings.append(f"{model_type} using defaults - consider training with your data")
                ready_count += 1
            else:
                # Model requires training (e.g., disease_classifier needs weights)
                model_status['status'] = 'requires_training'
                model_status['trained'] = False
                warnings.append(f"{model_type} requires trained weights to function")

            status['models'][model_type] = model_status

        # Update overall status
        status['ready_count'] = ready_count
        status['total_count'] = len(self.MODEL_TYPES)
        
        if warnings:
            status['warnings'] = warnings
        
        # Overall is healthy if all models are at least functional
        if ready_count == len(self.MODEL_TYPES):
            status['overall'] = 'healthy'
        elif ready_count > 0:
            status['overall'] = 'partially_ready'
        else:
            status['overall'] = 'not_ready'

        return status

    def save_all_models(self) -> Dict[str, str]:
        """
        Save all loaded models to disk.

        Returns:
            Dictionary of model_type: save_path
        """
        results = {}

        for key, model in self._models.items():
            model_type = key.split(':')[0]
            try:
                if hasattr(model, 'save'):
                    path = model.save()
                    results[model_type] = path
                    logger.info(f"Saved {model_type} to {path}")
                else:
                    results[model_type] = 'no_save_method'
            except Exception as e:
                logger.error(f"Failed to save {model_type}: {e}")
                results[model_type] = f'error: {str(e)}'

        return results

    def clear_model(self, model_type: str, version: Optional[str] = None) -> bool:
        """
        Clear a model from memory.

        Args:
            model_type: Type of model
            version: Specific version (optional)

        Returns:
            True if cleared successfully
        """
        if version:
            key = f"{model_type}:{version}"
            if key in self._models:
                del self._models[key]
                if key in self._model_info:
                    del self._model_info[key]
                logger.info(f"Cleared model: {key}")
                return True
        else:
            # Clear all versions
            keys_to_remove = [k for k in self._models if k.startswith(f"{model_type}:")]
            for key in keys_to_remove:
                del self._models[key]
                if key in self._model_info:
                    del self._model_info[key]

            if keys_to_remove:
                logger.info(f"Cleared {len(keys_to_remove)} models of type {model_type}")
                return True

        return False

    def get_metrics(self) -> Dict[str, Any]:
        """
        Get model performance metrics.

        Returns:
            Metrics dictionary
        """
        metrics = {
            'loaded_models': len(self._models),
            'model_types': len(self.MODEL_TYPES),
            'saved_models': len(list(MODEL_DIR.glob("*.pkl"))),
            'total_size_mb': sum(
                f.stat().st_size for f in MODEL_DIR.glob("*.pkl")
            ) / 1024 / 1024 if MODEL_DIR.exists() else 0
        }

        # Per-model metrics from metadata
        for key, info in self._model_info.items():
            if 'metrics' in info.get('metadata', {}):
                metrics[key] = info['metadata']['metrics']

        return metrics


# Global registry instance
_registry = None


def get_registry() -> ModelRegistry:
    """Get or create global model registry instance"""
    global _registry
    if _registry is None:
        _registry = ModelRegistry()
    return _registry
