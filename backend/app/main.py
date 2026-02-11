from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router

app = FastAPI(title="Crop Risk Platform API", openapi_url="/api/v1/openapi.json")

# Configure CORS to allow requests from the frontend
origins = [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:3000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router with prefix
app.include_router(api_router, prefix="/api/v1")

# Health check endpoint
@app.get("/api/v1/health")
def health_check():
    return {"status": "healthy", "service": "crop-risk-backend"}