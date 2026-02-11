"""
Base ML Model Class
Provides common interface for all ML models in the system
"""
import os
import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)

# Model storage directory
MODEL_DIR = Path(os.environ.get('MODEL_DIR', '/app/data/models'))


class BaseMLModel(ABC):
    """
    Abstract base class for all ML models.
    Provides common interface for training, prediction, and persistence.
    """

    def __init__(self, model_name: str, version: str = "1.0.0"):
        self.model_name = model_name
        self.version = version
        self.model = None
        self.metadata = {
            'name': model_name,
            'version': version,
            'created_at': None,
            'trained_at': None,
            'metrics': {},
            'parameters': {}
        }
        self._ensure_model_dir()

    def _ensure_model_dir(self):
        """Ensure model directory exists"""
        MODEL_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def model_path(self) -> Path:
        """Path to saved model file"""
        return MODEL_DIR / f"{self.model_name}_v{self.version}.pkl"

    @property
    def metadata_path(self) -> Path:
        """Path to model metadata file"""
        return MODEL_DIR / f"{self.model_name}_v{self.version}_metadata.json"

    @abstractmethod
    def train(self, X, y, **kwargs) -> Dict[str, float]:
        """
        Train the model on provided data.

        Args:
            X: Feature matrix
            y: Target vector
            **kwargs: Additional training parameters

        Returns:
            Dictionary of training metrics
        """
        pass

    @abstractmethod
    def predict(self, X) -> Any:
        """
        Make predictions on new data.

        Args:
            X: Feature matrix

        Returns:
            Predictions
        """
        pass

    @abstractmethod
    def save(self) -> str:
        """
        Save model to disk.

        Returns:
            Path to saved model
        """
        pass

    @abstractmethod
    def load(self, path: Optional[str] = None) -> bool:
        """
        Load model from disk.

        Args:
            path: Optional custom path to model file

        Returns:
            True if loaded successfully
        """
        pass

    def save_metadata(self):
        """Save model metadata to JSON file"""
        self.metadata['saved_at'] = datetime.utcnow().isoformat()
        with open(self.metadata_path, 'w') as f:
            json.dump(self.metadata, f, indent=2, default=str)
        logger.info(f"Metadata saved to {self.metadata_path}")

    def load_metadata(self) -> Dict:
        """Load model metadata from JSON file"""
        if self.metadata_path.exists():
            with open(self.metadata_path, 'r') as f:
                self.metadata = json.load(f)
            return self.metadata
        return {}

    def get_info(self) -> Dict[str, Any]:
        """Get model information"""
        return {
            'name': self.model_name,
            'version': self.version,
            'is_loaded': self.model is not None,
            'model_path': str(self.model_path),
            'exists': self.model_path.exists(),
            'metadata': self.metadata
        }


class ModelEvaluator:
    """
    Utility class for model evaluation metrics
    """

    @staticmethod
    def classification_metrics(y_true, y_pred, y_prob=None) -> Dict[str, float]:
        """Calculate classification metrics"""
        from sklearn.metrics import (
            accuracy_score, precision_score, recall_score,
            f1_score, roc_auc_score
        )

        metrics = {
            'accuracy': accuracy_score(y_true, y_pred),
            'precision': precision_score(y_true, y_pred, average='weighted', zero_division=0),
            'recall': recall_score(y_true, y_pred, average='weighted', zero_division=0),
            'f1_score': f1_score(y_true, y_pred, average='weighted', zero_division=0)
        }

        if y_prob is not None:
            try:
                metrics['roc_auc'] = roc_auc_score(y_true, y_prob, multi_class='ovr', average='weighted')
            except ValueError:
                pass

        return metrics

    @staticmethod
    def regression_metrics(y_true, y_pred) -> Dict[str, float]:
        """Calculate regression metrics"""
        from sklearn.metrics import (
            mean_squared_error, mean_absolute_error, r2_score
        )
        import numpy as np

        return {
            'mse': mean_squared_error(y_true, y_pred),
            'rmse': np.sqrt(mean_squared_error(y_true, y_pred)),
            'mae': mean_absolute_error(y_true, y_pred),
            'r2': r2_score(y_true, y_pred)
        }

    @staticmethod
    def anomaly_metrics(y_true, y_pred) -> Dict[str, float]:
        """Calculate anomaly detection metrics"""
        from sklearn.metrics import precision_score, recall_score, f1_score

        return {
            'precision': precision_score(y_true, y_pred, zero_division=0),
            'recall': recall_score(y_true, y_pred, zero_division=0),
            'f1_score': f1_score(y_true, y_pred, zero_division=0)
        }
