"""认证路由。

变更：
  * 删除无效的 get_current_user 占位函数（F-16），统一使用 app.auth.deps
  * /auth/me 改为请求头鉴权
  * /auth/refresh 由查询参数改为 JSON 请求体，避免长期令牌落入访问日志
"""
import uuid as uuid_lib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.jwt import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.auth.schemas import LoginRequest, RefreshRequest, TokenPair, UserCreate, UserOut
from app.db.models import User
from app.db.session import get_db

router = APIRouter(tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.username == data.username))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Username already exists")

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
        email=data.email,
        timezone=data.timezone,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserOut(
        id=str(user.id),
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        timezone=user.timezone,
        color=user.color,
    )


@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()
    # 统一错误信息，不区分“用户不存在/密码错误”
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")

    return TokenPair(
        access_token=create_access_token(user.id, user.username),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid refresh token")

    try:
        user_id = uuid_lib.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise HTTPException(401, "Invalid refresh token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")

    return TokenPair(
        access_token=create_access_token(user.id, user.username),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut(
        id=str(user.id),
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        timezone=user.timezone,
        color=user.color,
    )
