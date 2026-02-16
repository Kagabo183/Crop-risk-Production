# Import all models here for Alembic
from .user import User
from .farm import Farm
from .prediction import Prediction
from .alert import Alert
from .data import SatelliteImage, WeatherRecord, DiseaseClassification
from .crop_label import CropLabel
from .disease import Disease, DiseasePrediction, DiseaseObservation, DiseaseModelConfig, WeatherForecast
