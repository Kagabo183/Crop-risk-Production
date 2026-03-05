from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    admin = "admin"
    agronomist = "agronomist"
    farmer = "farmer"


class UserBase(BaseModel):
    email: str
    full_name: str = ""


class UserCreate(UserBase):
    password: str
    role: UserRole = UserRole.farmer
    phone: Optional[str] = None
    district: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    district: Optional[str] = None
    email: Optional[str] = None


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserOut(UserBase):
    id: int
    role: UserRole
    phone: Optional[str] = None
    district: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserOut


class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None
