from fastapi import APIRouter
from app.api.v1.endpoints import (
    farms, stress_monitoring, farm_satellite, ml, admin,
    early_warning, pipeline, fetch_real_data, auth, parcels, advisory,
    auto_crop_risk, geo_intelligence, precision_ag,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(farms.router, prefix="/farms", tags=["farms"])
api_router.include_router(parcels.router, prefix="/parcels", tags=["parcels"])
api_router.include_router(stress_monitoring.router, prefix="/stress-monitoring", tags=["stress-monitoring"])
api_router.include_router(farm_satellite.router, prefix="/farm-satellite", tags=["satellite"])
api_router.include_router(ml.router, prefix="/ml", tags=["machine-learning"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(early_warning.router, prefix="/early-warning", tags=["early-warning"])
api_router.include_router(pipeline.router, prefix="/pipeline", tags=["pipeline"])
api_router.include_router(fetch_real_data.router, tags=["real-data"])
api_router.include_router(advisory.router, prefix="/advisory", tags=["advisory"])
api_router.include_router(auto_crop_risk.router, prefix="/farm", tags=["auto-crop-risk"])
api_router.include_router(geo_intelligence.router,  prefix="/geo",          tags=["geo-intelligence"])
api_router.include_router(precision_ag.router,       prefix="/precision-ag",  tags=["precision-agriculture"])