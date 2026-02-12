"""
Authentication & authorization utilities.
JWT token handling + role-based access control dependencies.
"""
from functools import wraps
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.user import User as UserModel, UserRole
import os

SECRET_KEY = os.environ.get("SECRET_KEY", "secret")
ALGORITHM = os.environ.get("ALGORITHM", "HS256")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> UserModel:
    """Decode JWT token and return the current user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(UserModel).filter(UserModel.email == email).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_active_user(
    current_user: UserModel = Depends(get_current_user),
) -> UserModel:
    """Ensure the current user is active."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )
    return current_user


# ── Role-based access dependencies ──────────────────────────

def require_role(*allowed_roles: UserRole):
    """
    Factory that returns a dependency ensuring the current user
    has one of the allowed roles.

    Usage:
        @router.get("/admin-only", dependencies=[Depends(require_role(UserRole.admin))])
    """
    def role_checker(current_user: UserModel = Depends(get_current_active_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(r.value for r in allowed_roles)}",
            )
        return current_user
    return role_checker


# Convenience shortcuts
require_admin = require_role(UserRole.admin)

require_agronomist_or_above = require_role(
    UserRole.admin, UserRole.agronomist
)

require_farmer_or_above = require_role(
    UserRole.admin, UserRole.agronomist, UserRole.farmer
)

require_any_authenticated = require_role(
    UserRole.admin, UserRole.agronomist, UserRole.farmer, UserRole.viewer
)

def check_farm_access(farm, user: UserModel):
    """
    Enforce farm access rules:
    - Admin: All access
    - Agronomist: Access only if farm is in their district
    - Farmer: Access only if they own the farm
    - Viewer: Read-only access to all (metrics only)
    """
    if user.role == "admin" or user.role == "viewer":
        return True
    
    if user.role == "agronomist":
        # Handle "District - Sector" format in farm location
        farm_district = farm.location.split(" - ")[0] if farm.location and " - " in farm.location else farm.location
        if not user.district or farm_district != user.district:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Farm is not in your district ({user.district})."
            )
        return True

    if user.role == "farmer":
        if farm.owner_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. You do not own this farm."
            )
        return True
    
    return False
