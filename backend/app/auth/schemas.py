from pydantic import BaseModel, Field
from typing import Optional


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=128)
    email: Optional[str] = None
    timezone: str = "Asia/Shanghai"


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: Optional[str] = None
    timezone: str
    color: str

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    color: Optional[str] = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str

