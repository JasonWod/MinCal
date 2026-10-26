"""同步路由：全量同步、离线推送、增量拉取与实时广播。

修复要点：
  * F-03 广播按可见性分级（private 不外发，busy 只发掩码负载）
  * F-04 每个用户支持多台设备同时在线（原实现后连的覆盖先连的）
  * F-05 统一使用 Authorization 头鉴权
  * F-09 单条变更失败不再回滚整批；重复 create 幂等
  * F-14 WebSocket 空闲超时，避免半开连接堆积
"""
import asyncio
import json
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, resolve_access_user
from app.auth.jwt import decode_token
from app.authz import (
    InvalidError,
    lww_is_stale,
    mask_event_dict,
    normalize_visibility,
    parse_uuid,
    payload_level,
    validate_time_range,
)
from app.db.init_db import next_version
from app.db.models import Event, SyncCursor, User
from app.db.policy import visible_to
from app.db.session import get_db

router = APIRouter(prefix="/sync", tags=["sync"])

# WebSocket 空闲超时：超过该秒数未收到任何帧即视为断连并回收
WS_IDLE_TIMEOUT = 90

# 每个用户可拥有多个设备连接（F-04）
connected: dict = {}  # user_id(str) -> set[WebSocket]


def register_socket(user_id, ws) -> None:
    key = str(user_id)
    connected.setdefault(key, set()).add(ws)


def unregister_socket(user_id, ws) -> None:
    socks = connected.get(str(user_id))
    if not socks:
        return
    socks.discard(ws)
    if not socks:
        connected.pop(str(user_id), None)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def serialize_event(e: Event) -> dict:
    return {
        "id": str(e.id),
        "owner_id": str(e.owner_id),
        "title": e.title,
        "description": e.description,
        "start_time": e.start_time.isoformat() if e.start_time else None,
        "end_time": e.end_time.isoformat() if e.end_time else None,
        "location": e.location,
        "recurrence": e.recurrence,
        "reminder_min": e.reminder_min,
        "color": e.color,
        "visibility": e.visibility,
        "all_day": e.all_day,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
        "version": e.version,
        "deleted": e.deleted,
    }


def _frame(change_type: str, payload: dict, actor: str) -> str:
    return json.dumps(
        {"type": change_type, "event": payload, "actor": actor, "ts": _now()},
        ensure_ascii=False,
        default=str,
    )


async def _send_to_user(user_id, message: str) -> None:
    for ws in list(connected.get(str(user_id), set())):
        try:
            await ws.send_text(message)
        except Exception:
            unregister_socket(user_id, ws)


async def broadcast_change(event, change_type: str, actor_id: str) -> None:
    """按查看者可见性分级广播（修复 F-03 的明文全量广播）。

    private   -> 只发给所有者（其其它设备需要更新）
    busy      -> 其他用户只收到掩码负载（title="Busy"，无描述/地点/颜色）
    public    -> 全量
    删除事件   -> 负载仅含 id，对所有在线客户端广播以便移除
    """
    if change_type.endswith("deleted"):
        event_id = str(event.id) if hasattr(event, "id") else str(event)
        message = _frame(change_type, {"id": event_id}, str(actor_id))
        for uid in list(connected.keys()):
            await _send_to_user(uid, message)
        return

    full = serialize_event(event)
    owner = str(getattr(event, "owner_id", ""))
    visibility = getattr(event, "visibility", None)
    for uid in list(connected.keys()):
        if payload_level(visibility, owner, uid) == "skip":
            continue
        await _send_to_user(uid, _frame(change_type, mask_event_dict(full, uid), str(actor_id)))


def _coerce_dt(value, field: str) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise InvalidError(f"{field} 不是合法时间：{value!r}")
    raise InvalidError(f"{field} 缺失或类型错误：{value!r}")


@router.post("/initial")
async def initial_sync(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """全量同步：返回当前用户可见的所有事件与当前版本号。"""
    results = await db.execute(
        select(Event).where(Event.deleted == False, visible_to(user.id)).order_by(Event.start_time)
    )
    events = results.scalars().all()

    ver_result = await db.execute(text("SELECT last_value FROM event_version_seq"))
    max_ver = ver_result.scalar() or 0

    return {
        "events": [mask_event_dict(serialize_event(e), user.id) for e in events],
        "version": max_ver,
    }


async def _apply_change(db: AsyncSession, user: User, op: str, data: dict) -> tuple:
    """应用单条变更，返回 (result, broadcast)；broadcast = (change_type, payload_obj) | None。"""
    raw_id = data.get("id")
    event_id = parse_uuid(raw_id, "id") if raw_id else None

    if op == "create":
        if event_id is not None:
            existing = await db.execute(select(Event).where(Event.id == event_id))
            if existing.scalar_one_or_none() is not None:
                # F-09：重复推送同一 create -> 幂等，不再撞主键
                return {"id": str(event_id), "status": "already_exists"}, None
        title = (data.get("title") or "").strip()
        if not title:
            raise InvalidError("标题不能为空")
        start = _coerce_dt(data.get("start_time"), "start_time")
        end = _coerce_dt(data.get("end_time"), "end_time")
        validate_time_range(start, end)
        event = Event(
            id=event_id or uuid_lib.uuid4(),
            owner_id=user.id,
            title=title,
            description=data.get("description"),
            start_time=start,
            end_time=end,
            location=data.get("location"),
            recurrence=data.get("recurrence"),
            reminder_min=data.get("reminder_min"),
            color=data.get("color"),
            visibility=normalize_visibility(data.get("visibility"), default="busy"),
            all_day=bool(data.get("all_day", False)),
            version=await next_version(),
        )
        db.add(event)
        await db.flush()
        return {"id": str(event.id), "status": "created", "version": event.version}, ("event_created", event)

    if op == "update":
        if event_id is None:
            raise InvalidError("update 缺少 id")
        result = await db.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event or event.deleted:
            return {"id": str(event_id), "status": "not_found"}, None
        if event.owner_id != user.id:
            return {"id": str(event_id), "status": "forbidden"}, None

        if lww_is_stale(data.get("version"), event.version):
            return {"id": str(event_id), "status": "conflict", "server_version": event.version}, None

        new_start = _coerce_dt(data["start_time"], "start_time") if "start_time" in data else event.start_time
        new_end = _coerce_dt(data["end_time"], "end_time") if "end_time" in data else event.end_time
        validate_time_range(new_start, new_end)

        for field in ["title", "description", "location", "recurrence", "color", "all_day", "reminder_min"]:
            if field in data:
                setattr(event, field, data[field])
        if "visibility" in data:
            event.visibility = normalize_visibility(data["visibility"])
        if "title" in data:
            event.title = (data.get("title") or "").strip() or event.title
        event.start_time = new_start
        event.end_time = new_end
        event.version = await next_version()
        return {"id": str(event_id), "status": "updated", "version": event.version}, ("event_updated", event)

    if op == "delete":
        if event_id is None:
            raise InvalidError("delete 缺少 id")
        result = await db.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            return {"id": str(event_id), "status": "not_found"}, None
        if event.owner_id != user.id:
            return {"id": str(event_id), "status": "forbidden"}, None
        if event.deleted:
            return {"id": str(event_id), "status": "already_deleted"}, None
        event.deleted = True
        event.version = await next_version()
        return {"id": str(event_id), "status": "deleted", "version": event.version}, ("event_deleted", event_id)

    raise InvalidError(f"未知操作：{op!r}")


@router.post("/push")
async def push_changes(
    changes: list[dict],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """客户端离线期间产生的变更批量上行。

    每条变更走独立 SAVEPOINT：单条失败只回滚该条并回报状态，
    不再出现“一条坏数据让整批回滚、离线队列永久卡死”。
    """
    results = []
    pending_broadcasts = []

    for change in changes:
        op = (change or {}).get("op", "update")
        data = (change or {}).get("data") or {}
        try:
            async with db.begin_nested():
                result, broadcast = await _apply_change(db, user, op, data)
                if broadcast is not None:
                    pending_broadcasts.append(broadcast)
                results.append(result)
                await db.flush()
        except InvalidError as exc:
            results.append({"id": data.get("id"), "status": "invalid", "error": exc.message})
        except IntegrityError:
            results.append({"id": data.get("id"), "status": "invalid", "error": "数据库约束冲突"})

    await db.commit()

    # 提交成功后再广播，避免把未落库的数据通知给其他客户端
    for change_type, payload in pending_broadcasts:
        await broadcast_change(payload, change_type, str(user.id))

    return {"results": results}


@router.get("/pull")
async def pull_changes(
    since: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """增量拉取 version > since 的可见变更（含 tombstone）。"""
    results = await db.execute(
        select(Event)
        .where(Event.version > since, visible_to(user.id))
        .order_by(Event.version)
    )
    events = results.scalars().all()

    new_version = events[-1].version if events else since
    if new_version != since:
        cursor = SyncCursor(user_id=user.id, last_event_ver=new_version)
        db.merge(cursor)
        await db.commit()

    return {
        "events": [mask_event_dict(serialize_event(e), user.id) for e in events],
        "version": new_version,
    }


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    # 先验令牌再 accept，避免为非法连接建立 socket（F-14）
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=4001)
        return

    try:
        user_id = str(uuid_lib.UUID(str(payload.get("sub"))))
    except (ValueError, TypeError):
        await websocket.close(code=4001)
        return

    await websocket.accept()
    register_socket(user_id, websocket)
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=WS_IDLE_TIMEOUT)
            except asyncio.TimeoutError:
                await websocket.close(code=4002)  # 空闲超时，回收半开连接
                break
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        unregister_socket(user_id, websocket)
