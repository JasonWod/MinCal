"""统一鉴权依赖。

优先读取 `Authorization: Bearer <token>` 请求头；为兼容尚未升级的旧客户端，
仍接受已废弃的 `?token=` 查询参数（新代码请勿使用，令牌出现在 URL 会进入
访问日志与代理日志）。
"""
import uuid as uuid_lib
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import decode_token
from app.db.models import User
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def extract_bearer_token(request: Request, credentials, query_token) -> str:
    """按优先级提取令牌：HTTPBearer -> 原始 Authorization 头 -> 查询参数。"""
    if credentials is not None and getattr(credentials, "credentials", None):
        return credentials.credentials.strip()
    header = request.headers.get("authorization", "") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return (query_token or "").strip()


async def resolve_access_user(raw_token: str, db: AsyncSession) -> User:
    if not raw_token:
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(raw_token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(401, "Invalid token")
    try:
        user_id = uuid_lib.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise HTTPException(401, "Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "User not found")
    return user


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token: Optional[str] = Query(
        None, deprecated=True, description="旧客户端兼容参数，请改用 Authorization 头"
    ),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw = extract_bearer_token(request, credentials, token)
    return await resolve_access_user(raw, db)
