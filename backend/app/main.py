import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.v1.api import api_router

app = FastAPI(title="Crop Risk Platform API", openapi_url="/api/v1/openapi.json")

# Serve uploaded classification images at /uploads/
uploads_dir = Path(os.environ.get('UPLOAD_DIR', '/app/data/uploads'))
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Configure CORS to allow requests from frontend and mobile app
origins = [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "https://localhost",          # Capacitor Android
    "capacitor://localhost",      # Capacitor iOS
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://.*\.onrender\.com",  # Render deployment
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