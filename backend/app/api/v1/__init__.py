"""
API v1 router initialization
Includes disease prediction and stress monitoring endpoints
"""
from fastapi import APIRouter
from app.api.v1 import diseases
from app.api.v1.endpoints import stress_monitoring

api_router = APIRouter()

# Include disease prediction routes
api_router.include_router(diseases.router)

# Include stress monitoring routes
api_router.include_router(
    stress_monitoring.router,
    prefix="/stress",
    tags=["stress-monitoring"]
)

# Add other routers here as needed
# api_router.include_router(farms.router)
# api_router.include_router(predictions.router)
# api_router.include_router(alerts.router)

