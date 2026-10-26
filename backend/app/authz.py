"""集中式安全与同步策略（纯函数、无 I/O，便于单元测试）。

设计原则：
1. “谁能看什么 / 广播给谁 / 如何掩码 / 版本冲突” 只在此处决策一次，所有路由复用。
   历史上的越权正是因为在各接口分别手写过滤条件而漏掉。
2. 未知值一律按最严格处理，杜绝“拼写错误即变公开”。
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

VISIBILITIES: tuple = ("public", "busy", "private")
# 非所有者查看他人 busy 事件时的占位标题
BUSY_MASK = "Busy"
# busy 掩码时需要清空的字段
MASKABLE_FIELDS: tuple = ("description", "location", "color")


class PolicyError(ValueError):
    """策略判定失败基类，路由层按 status_code 统一转 HTTP。"""

    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class InvalidError(PolicyError):
    """输入不合法 -> 422"""

    status_code = 422


class ForbiddenError(PolicyError):
    """越权 -> 403"""

    status_code = 403


def normalize_visibility(value, default: str = "busy") -> str:
    """写入路径：严格校验可见性，未知值直接报错。

    旧实现用裸 str 接收，写成 "bussy" 时既不报错又因 != "busy" 而不被掩码，
    等于“拼错即公开”。
    """
    if value is None:
        return default
    v = str(value).strip().lower()
    if v not in VISIBILITIES:
        raise InvalidError(f"visibility 非法：{value!r}，仅支持 {VISIBILITIES}")
    return v


def effective_visibility(value) -> str:
    """读取路径：宽容归一，历史脏数据/未知值按最严格的 private 处理。"""
    v = str(value or "").strip().lower()
    return v if v in VISIBILITIES else "private"


def parse_uuid(value, field: str = "id") -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except Exception as exc:  # ValueError/AttributeError/TypeError
        raise InvalidError(f"{field} 不是合法 UUID：{value!r}") from exc


def validate_time_range(start, end) -> None:
    if start is None or end is None:
        raise InvalidError("start_time 与 end_time 均为必填")
    if end <= start:
        raise InvalidError("end_time 必须晚于 start_time")


def is_owner(event_owner_id, viewer_id) -> bool:
    return viewer_id is not None and str(event_owner_id) == str(viewer_id)


def can_view(event_visibility, event_owner_id, viewer_id) -> bool:
    """查看者是否有权获取该事件（private 仅所有者）。"""
    if viewer_id is None:
        return False
    if is_owner(event_owner_id, viewer_id):
        return True
    return effective_visibility(event_visibility) != "private"


def needs_mask(event_visibility, event_owner_id, viewer_id) -> bool:
    """他人 busy 事件只露“忙碌”，标题/描述/地点/颜色一律隐藏。"""
    if is_owner(event_owner_id, viewer_id):
        return False
    return effective_visibility(event_visibility) == "busy"


def mask_event_dict(payload: Dict[str, Any], viewer_id) -> Dict[str, Any]:
    """返回按查看者掩码后的副本，不修改入参。"""
    if not needs_mask(payload.get("visibility"), payload.get("owner_id"), viewer_id):
        return payload
    masked = dict(payload)
    masked["title"] = BUSY_MASK
    for field in MASKABLE_FIELDS:
        if field in masked:
            masked[field] = None
    return masked


def payload_level(event_visibility, event_owner_id, viewer_id) -> str:
    """实时广播分级：full / masked / skip。"""
    if viewer_id is None:
        return "skip"
    if is_owner(event_owner_id, viewer_id):
        return "full"
    level = effective_visibility(event_visibility)
    if level == "private":
        return "skip"
    return "masked" if level == "busy" else "full"


def resolve_owner_scope(requested_owner, viewer_id) -> Optional[str]:
    """owner 查询参数只允许等于当前用户，请求他人一律 403。

    返回 None 表示“不限归属”，但可见性过滤仍然叠加生效。
    旧实现在传入 owner 时整体替换掉可见性条件，可直接列出他人 private 事件。
    """
    if requested_owner is None or str(requested_owner).strip() == "":
        return None
    requested = parse_uuid(requested_owner, "owner")
    if viewer_id is None or requested != parse_uuid(viewer_id, "viewer"):
        raise ForbiddenError("只能查询本人的日程列表")
    return str(requested)


def if_match_conflicts(if_match, server_version) -> bool:
    """乐观锁。None 表示不做冲突检查；注意 0 也必须参与比较。

    旧写法 `if if_match and ...` 会把 If-Match: 0 当成未提供而跳过检查。
    """
    if if_match is None:
        return False
    try:
        client = int(if_match)
    except (TypeError, ValueError):
        raise InvalidError(f"If-Match 必须是整数版本号：{if_match!r}")
    return client != int(server_version or 0)


def lww_is_stale(client_version, server_version) -> bool:
    """Last-Write-Wins 判定：客户端版本低于服务端 -> 陈旧（保留服务端）。

    客户端未带版本号（None/0）时不判陈旧，兼容离线首次同步。
    """
    if not client_version:
        return False
    try:
        client = int(client_version)
    except (TypeError, ValueError):
        return False
    return client < int(server_version or 0)
