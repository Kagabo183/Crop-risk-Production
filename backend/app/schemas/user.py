from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    admin = "admin"
    agronomist = "agronomist"
    farmer = "farmer"


class UserBase(BaseModel):
    username: str
    full_name: str = ""


class UserCreate(UserBase):
    password: str
    role: UserRole = UserRole.farmer
    phone: Optional[str] = None
    district: Optional[str] = None

    @validator('password')
    def validate_pin(cls, v):
        if not v.isdigit() or len(v) != 5:
            raise ValueError('Password must be a 5-digit PIN')
        return v


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    district: Optional[str] = None
    username: Optional[str] = None


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
    username: Optional[str] = None
    role: Optional[str] = None
