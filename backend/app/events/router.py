"""事件 CRUD 路由。

安全约定（全部委托 app.authz，勿在此重写判定逻辑）：
  * 读：任何列表/详情都必须叠加 visible_to()，private 仅所有者可见
  * 改/删：仅所有者
  * 掩码：他人 busy 事件对查看者只露 "Busy"
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.authz import (
    InvalidError,
    can_view,
    if_match_conflicts,
    is_owner,
    mask_event_dict,
    normalize_visibility,
    resolve_owner_scope,
    validate_time_range,
)
from app.db.init_db import next_version
from app.db.models import Event, EventAttendee, User
from app.db.policy import visible_to
from app.db.session import get_db

router = APIRouter(prefix="/events", tags=["events"])

# 绝不允许通过通用字段赋值改写的列
PROTECTED_FIELDS = frozenset({"id", "owner_id", "version", "deleted", "created_at", "updated_at"})


def _clean_title(value: str) -> str:
    if value is None or not str(value).strip():
        raise ValueError("标题不能为空")
    return str(value).strip()


def _canonical_attendees(values) -> list:
    """把参与者规范成 uuid 字符串；非法值直接 422。"""
    if not values:
        return []
    out = []
    for v in values:
        try:
            out.append(str(uuid.UUID(str(v))))
        except (ValueError, TypeError):
            raise ValueError(f"参与者不是合法用户 ID：{v!r}")
    return list(dict.fromkeys(out))  # 去重保序


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    location: Optional[str] = None
    recurrence: Optional[str] = None
    reminder_min: Optional[int] = None
    color: Optional[str] = None
    visibility: str = "busy"
    all_day: bool = False
    attendees: list[str] = []

    @field_validator("title")
    @classmethod
    def _v_title(cls, v):
        return _clean_title(v)

    @field_validator("visibility")
    @classmethod
    def _v_visibility(cls, v):
        return normalize_visibility(v)

    @field_validator("attendees")
    @classmethod
    def _v_attendees(cls, v):
        return _canonical_attendees(v)

    @field_validator("reminder_min")
    @classmethod
    def _v_reminder(cls, v):
        if v is None:
            return None
        if v < 0 or v > 60 * 24 * 14:
            raise ValueError("reminder_min 需在 0..20160 分钟之间")
        return v

    @model_validator(mode="after")
    def _v_range(self):
        # F-06：此前服务端完全不校验，倒序区间可直接入库
        validate_time_range(self.start_time, self.end_time)
        return self


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    location: Optional[str] = None
    recurrence: Optional[str] = None
    reminder_min: Optional[int] = None
    color: Optional[str] = None
    visibility: Optional[str] = None
    all_day: Optional[bool] = None
    attendees: Optional[list[str]] = None

    @field_validator("title")
    @classmethod
    def _v_title(cls, v):
        return None if v is None else _clean_title(v)

    @field_validator("visibility")
    @classmethod
    def _v_vis(cls, v):
        return None if v is None else normalize_visibility(v)

    @field_validator("attendees")
    @classmethod
    def _v_att(cls, v):
        return None if v is None else _canonical_attendees(v)


class EventOut(BaseModel):
    id: str
    owner_id: str
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    location: Optional[str] = None
    recurrence: Optional[str] = None
    reminder_min: Optional[int] = None
    color: Optional[str] = None
    visibility: str
    all_day: bool
    created_at: datetime
    updated_at: datetime
    version: int

    class Config:
        from_attributes = True


def parse_path_uuid(value, field: str = "event_id") -> uuid.UUID:
    """F-11：路径参数非法 UUID 返回 400，而不是抛 ValueError 变成 500。"""
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(400, f"{field} 不是合法 UUID")


def to_out(event: Event, viewer_id) -> EventOut:
    """序列化 + 按查看者权限掩码（他人 busy -> Busy）。"""
    data = {k: getattr(event, k) for k in EventOut.__fields__}
    data["id"] = str(event.id)
    data["owner_id"] = str(event.owner_id)
    return EventOut(**mask_event_dict(data, viewer_id))


async def _replace_attendees(db: AsyncSession, event_id: uuid.UUID, attendee_ids: list, owner_id) -> None:
    """整体替换参与者；未知用户直接 422（不静默丢弃）。"""
    wanted = [a for a in (attendee_ids or []) if a != str(owner_id)]
    if wanted:
        rows = await db.execute(select(User.id).where(User.id.in_([uuid.UUID(a) for a in wanted])))
        found = {str(u) for u in rows.scalars().all()}
        missing = [a for a in wanted if a not in found]
        if missing:
            raise InvalidError(f"参与者不存在：{', '.join(missing)}")
    await db.execute(delete(EventAttendee).where(EventAttendee.event_id == event_id))
    for a in wanted:
        db.add(EventAttendee(event_id=event_id, user_id=uuid.UUID(a), status="needs_action"))


@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    data: EventCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    event_id = uuid.uuid4()
    # F-10：先校验参与者，再落库（此前 attendees 被完全忽略）
    if data.attendees:
        await _replace_attendees(db, event_id, data.attendees, user.id)

    event = Event(
        id=event_id,
        owner_id=user.id,
        title=data.title,
        description=data.description,
        start_time=data.start_time,
        end_time=data.end_time,
        location=data.location,
        recurrence=data.recurrence,
        reminder_min=data.reminder_min,
        color=data.color,
        visibility=data.visibility,
        all_day=data.all_day,
        version=await next_version(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return to_out(event, user.id)


@router.get("", response_model=list[EventOut])
async def list_events(
    start: datetime = Query(...),
    end: datetime = Query(...),
    owner: Optional[str] = Query(None),
    visibility: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # F-02：owner 只能是本人；可见性过滤恒定叠加，不再被 owner 参数顶掉
    owner_scope = resolve_owner_scope(owner, user.id)

    query = select(Event).where(
        Event.start_time < end,
        Event.end_time >= start,
        Event.deleted == False,
        visible_to(user.id),
    )
    if owner_scope is not None:
        query = query.where(Event.owner_id == uuid.UUID(owner_scope))
    if visibility is not None:
        query = query.where(Event.visibility == normalize_visibility(visibility))

    results = await db.execute(query.order_by(Event.start_time))
    return [to_out(e, user.id) for e in results.scalars().all()]


@router.get("/{event_id}", response_model=EventOut)
async def get_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    eid = parse_path_uuid(event_id)
    result = await db.execute(select(Event).where(Event.id == eid))
    event = result.scalar_one_or_none()
    if not event or event.deleted:
        raise HTTPException(404, "Not found")
    # F-01：无权限与不存在统一 404，既不泄漏内容也不泄漏存在性
    if not can_view(event.visibility, event.owner_id, user.id):
        raise HTTPException(404, "Not found")
    return to_out(event, user.id)


@router.put("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: str,
    data: EventUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    if_match: Optional[int] = Query(None, alias="If-Match"),
):
    eid = parse_path_uuid(event_id)
    result = await db.execute(select(Event).where(Event.id == eid))
    event = result.scalar_one_or_none()
    if not event or event.deleted:
        raise HTTPException(404, "Not found")
    if not is_owner(event.owner_id, user.id):
        raise HTTPException(403, "Not your event")

    # F-08：If-Match=0 也必须参与比较
    if if_match_conflicts(if_match, event.version):
        raise HTTPException(409, "Version conflict")

    changes = data.model_dump(exclude_unset=True)
    # F-06：局部更新后仍要满足 end > start
    validate_time_range(changes.get("start_time", event.start_time), changes.get("end_time", event.end_time))

    for field, val in changes.items():
        if field in PROTECTED_FIELDS or not hasattr(event, field):
            continue
        setattr(event, field, val)

    if "attendees" in changes:
        await _replace_attendees(db, eid, changes["attendees"], user.id)

    event.version = await next_version()
    await db.commit()
    await db.refresh(event)
    return to_out(event, user.id)


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    eid = parse_path_uuid(event_id)
    result = await db.execute(select(Event).where(Event.id == eid))
    event = result.scalar_one_or_none()
    if not event or event.deleted:
        raise HTTPException(404, "Not found")
    if not is_owner(event.owner_id, user.id):
        raise HTTPException(403, "Not your event")

    event.deleted = True
    event.version = await next_version()
    await db.commit()
