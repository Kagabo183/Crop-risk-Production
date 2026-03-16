# Import all models here for Alembic
from .user import User
from .farm import Farm
from .prediction import Prediction
from .alert import Alert
from .data import SatelliteImage, WeatherRecord, DiseaseClassification, FarmVegetationMetric
from .crop_label import CropLabel
from .disease import Disease, DiseasePrediction, DiseaseObservation, DiseaseModelConfig, WeatherForecast
from .geo_intelligence import (
    ProductivityZone, ScoutingObservation, NdviOverlay,
    DetectedField, UserField, FieldCropClassification,
)
from .precision_ag import Season, CropRotation, SoilSample, SoilNutrientResult, YieldMap, VraMap
from .phenology import PhenologyRecord
