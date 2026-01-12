from fastapi import APIRouter
from app.api.v1.endpoints import users, predictions, farms, alerts, auth, features, satellite, predict, satellite_images, farm_satellite, analytics, data_management, pipeline, weather, remote_sensing, crop_type
from app.api.v1 import diseases

api_router = APIRouter()

api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(predictions.router, prefix="/predictions", tags=["predictions"])
api_router.include_router(farms.router, prefix="/farms", tags=["farms"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(features.router, prefix="/features", tags=["features"])
api_router.include_router(satellite.router, prefix="/satellite", tags=["satellite"])
api_router.include_router(satellite_images.router, prefix="/satellite-images", tags=["satellite-images"])
api_router.include_router(predict.router, prefix="/predict", tags=["predict"])
api_router.include_router(farm_satellite.router, prefix="/farm-satellite", tags=["farm-satellite"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(data_management.router, prefix="/data", tags=["data-management"])
api_router.include_router(pipeline.router, prefix="/pipeline", tags=["pipeline"])
api_router.include_router(weather.router, prefix="/weather", tags=["weather"])
api_router.include_router(remote_sensing.router, prefix="/remote-sensing", tags=["remote-sensing"])
api_router.include_router(crop_type.router, prefix="/crop-type", tags=["crop-type"])

# Disease Prediction Endpoints (NEW)
api_router.include_router(diseases.router, prefix="/diseases", tags=["diseases"])
