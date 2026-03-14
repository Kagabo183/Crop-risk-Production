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
    # Legacy frontend (kept for backward compat)
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    # web-app (Vite dev server)
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    # mobile-app (Vite dev server / browser preview)
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    # Capacitor native shells
    "https://localhost",
    "capacitor://localhost",
    "http://localhost",
    "http://192.168.1.101",
    "http://192.168.1.101:8000",
    "http://192.168.1.101:5175",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(.*\.onrender\.com|.*\.vercel\.app)",  # Render + Vercel deployments
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

# Temporary debug endpoint — remove after fixing
@app.get("/api/v1/debug/db")
def debug_db():
    import traceback
    from sqlalchemy import text, inspect
    from app.db.database import engine
    result = {"database_url_prefix": str(engine.url)[:30] + "..."}
    try:
        with engine.connect() as conn:
            result["connection"] = "OK"
            inspector = inspect(engine)
            result["tables"] = inspector.get_table_names()
            if "users" in result["tables"]:
                cols = inspector.get_columns("users")
                result["users_columns"] = [c["name"] for c in cols]
            else:
                result["users_columns"] = "TABLE NOT FOUND"
    except Exception as e:
        result["error"] = str(e)
        result["traceback"] = traceback.format_exc()
    return result

@app.get("/api/v1/debug/register-test")
def debug_register_test():
    import traceback
    from app.db.database import SessionLocal
    from app.models.user import User as UserModel, UserRole
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    try:
        db = SessionLocal()
        new_user = UserModel(
            username="debugtest",
            hashed_password=pwd_context.hash("12345"),
            full_name="Debug Test",
            role=UserRole.farmer,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        # Clean up
        db.delete(new_user)
        db.commit()
        db.close()
        return {"status": "OK", "message": "User creation works!"}
    except Exception as e:
        return {"status": "FAILED", "error": str(e), "traceback": traceback.format_exc()}