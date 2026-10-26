import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.db.models import User
from app.auth.jwt import decode_token
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import uuid as uuid_lib

security = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/users", tags=["users"])


async def get_auth_user(credentials: HTTPAuthorizationCredentials | None, db: AsyncSession) -> User:
    if not credentials:
        raise HTTPException(401)
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(401)
    user_id = uuid_lib.UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401)
    return user


@router.get("/me")
async def me(credentials: HTTPAuthorizationCredentials = Depends(security), db: AsyncSession = Depends(get_db)):
    user = await get_auth_user(credentials, db)
    return {
        "id": str(user.id), "username": user.username, "display_name": user.display_name,
        "email": user.email, "timezone": user.timezone, "color": user.color,
    }


@router.put("/me")
async def update_me(
    data: dict,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    user = await get_auth_user(credentials, db)
    for field in ["display_name", "email", "timezone", "color"]:
        if field in data:
            setattr(user, field, data[field])
    await db.commit()
    return {
        "id": str(user.id), "username": user.username, "display_name": user.display_name,
        "email": user.email, "timezone": user.timezone, "color": user.color,
    }


@router.get("")
async def list_users(credentials: HTTPAuthorizationCredentials = Depends(security), db: AsyncSession = Depends(get_db)):
    """List all users (for calendar overlay)."""
    user = await get_auth_user(credentials, db)
    result = await db.execute(select(User))
    users = result.scalars().all()
    return [
        {"id": str(u.id), "username": u.username, "display_name": u.display_name, "color": u.color}
        for u in users
    ]
