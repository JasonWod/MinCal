#!/bin/bash
# Creates the mincal project directory structure and backend files
set -e
BASE="/home/onyx/projects/mincal"

mkdir -p $BASE/{backend/app/{db,auth,events,sync,users},client/src-tauri/{src,icons},client/src/{components/{TrayPopup,Calendar},hooks,stores,lib},.github/workflows,scripts,docs}

# === BACKEND ===

cat > $BASE/backend/requirements.txt << 'EOF'
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
pydantic>=2.4.0
pydantic-settings>=2.0.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
python-multipart>=0.0.6
EOF

cat > $BASE/backend/Dockerfile << 'EOF'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF

cat > $BASE/backend/app/__init__.py << 'EOF'
EOF

cat > $BASE/backend/app/config.py << 'EOF'
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://mincal:CHANGE_ME@localhost:5432/mincal"
    jwt_secret: str = "mincal-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    refresh_expire_days: int = 30
    cors_origins: str = "http://localhost,http://127.0.0.1,http://localhost:25173"

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
EOF

cat > $BASE/backend/app/db/__init__.py << 'EOF'
EOF

cat > $BASE/backend/app/db/session.py << 'EOF'
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False, pool_size=10, max_overflow=20)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
EOF

cat > $BASE/backend/app/db/models.py << 'EOF'
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, Integer, BigInteger, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str | None] = mapped_column(String(256))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")
    color: Mapped[str] = mapped_column(String(7), default="#4F46E5")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    events = relationship("Event", back_populates="owner", cascade="all, delete-orphan")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    location: Mapped[str | None] = mapped_column(String(512))
    recurrence: Mapped[str | None] = mapped_column(Text)
    rrule_exdate: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    reminder_min: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str | None] = mapped_column(String(7))
    visibility: Mapped[str] = mapped_column(String(16), default="busy")
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(BigInteger, default=0)

    owner = relationship("User", back_populates="events")
    attendees = relationship("EventAttendee", back_populates="event", cascade="all, delete-orphan")


class EventAttendee(Base):
    __tablename__ = "event_attendees"

    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="needs_action")

    event = relationship("Event", back_populates="attendees")
    user = relationship("User")


class SyncCursor(Base):
    __tablename__ = "sync_cursors"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_event_ver: Mapped[int] = mapped_column(BigInteger, default=0)
    last_sync_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
EOF

cat > $BASE/backend/app/auth/__init__.py << 'EOF'
EOF

cat > $BASE/backend/app/auth/jwt.py << 'EOF'
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: uuid.UUID, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {"sub": str(user_id), "username": username, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_expire_days)
    payload = {"sub": str(user_id), "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
EOF

echo "Backend phase 1 done"
