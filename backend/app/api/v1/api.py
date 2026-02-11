from fastapi import APIRouter
from app.api.v1.endpoints import farms, stress_monitoring, farm_satellite, ml

api_router = APIRouter()

api_router.include_router(farms.router, prefix="/farms", tags=["farms"])
api_router.include_router(stress_monitoring.router, prefix="/stress-monitoring", tags=["stress-monitoring"])
api_router.include_router(farm_satellite.router, prefix="/farm-satellite", tags=["satellite"])
api_router.include_router(ml.router, prefix="/ml", tags=["machine-learning"])