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
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(BigInteger, default=0)

    owner = relationship("User", back_populates="events")
    attendees = relationship("EventAttendee", back_populates="event", cascade="all, delete-orphan")


class EventAttendee(Base):
    __tablename__ = "event_attendees"

    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(16), default="needs_action")

    event = relationship("Event", back_populates="attendees")
    user = relationship("User")


class SyncCursor(Base):
    __tablename__ = "sync_cursors"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    last_event_ver: Mapped[int] = mapped_column(BigInteger, default=0)
    last_sync_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
