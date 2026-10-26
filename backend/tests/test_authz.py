"""authz 纯策略回归测试（无需数据库）。

覆盖安全红线：越权读取、未知可见性绕过、掩码遗漏、乐观锁跳过。
"""
import uuid

import pytest

from app.authz import (
    BUSY_MASK,
    ForbiddenError,
    InvalidError,
    can_view,
    effective_visibility,
    if_match_conflicts,
    is_owner,
    lww_is_stale,
    mask_event_dict,
    needs_mask,
    normalize_visibility,
    parse_uuid,
    payload_level,
    resolve_owner_scope,
    validate_time_range,
)
from datetime import datetime, timedelta

OWNER = uuid.uuid4()
OTHER = uuid.uuid4()


# ---------- 可见性枚举 ----------
@pytest.mark.parametrize("value", ["public", "busy", "private", " BUSY "])
def test_normalize_visibility_accepts_known(value):
    assert normalize_visibility(value) == value.strip().lower()


def test_normalize_visibility_rejects_typo():
    # 回归：旧实现用裸 str 接收，"bussy" 会被放过且因 != "busy" 而不被掩码
    with pytest.raises(InvalidError):
        normalize_visibility("bussy")


def test_normalize_visibility_default():
    assert normalize_visibility(None) == "busy"


@pytest.mark.parametrize("value", ["", None, "weird", "Publick"])
def test_effective_visibility_unknown_is_most_restrictive(value):
    assert effective_visibility(value) == "private"


# ---------- UUID / 时间区间 ----------
def test_parse_uuid_accepts_uuid_and_str():
    u = uuid.uuid4()
    assert parse_uuid(u) == u
    assert parse_uuid(str(u)) == u


def test_parse_uuid_rejects_garbage():
    with pytest.raises(InvalidError):
        parse_uuid("abc", "event_id")


def test_validate_time_range_rejects_inverted_and_equal():
    t0 = datetime(2026, 1, 1, 9, 0)
    with pytest.raises(InvalidError):
        validate_time_range(t0, t0 - timedelta(minutes=1))
    with pytest.raises(InvalidError):
        validate_time_range(t0, t0)
    validate_time_range(t0, t0 + timedelta(minutes=1))  # 合法，不抛异常


# ---------- 归属 / 查看权 ----------
def test_is_owner():
    assert is_owner(OWNER, OWNER)
    assert is_owner(str(OWNER), OWNER)
    assert not is_owner(OWNER, OTHER)
    assert not is_owner(OWNER, None)


def test_owner_can_view_own_private():
    assert can_view("private", OWNER, OWNER)


def test_anonymous_cannot_view_anything():
    for vis in ("public", "busy", "private"):
        assert not can_view(vis, OWNER, None)


@pytest.mark.parametrize("vis", ["public", "busy"])
def test_other_can_view_non_private(vis):
    assert can_view(vis, OWNER, OTHER)


def test_other_cannot_view_private():
    assert not can_view("private", OWNER, OTHER)


def test_unknown_visibility_treated_as_private_for_strangers():
    # 回归：脏数据/未知值不得被当作可见
    assert not can_view("bussy", OWNER, OTHER)
    assert can_view("bussy", OWNER, OWNER)


# ---------- 掩码 ----------
@pytest.mark.parametrize("vis", ["busy", "BUSY", " busy "])
def test_other_busy_needs_mask(vis):
    assert needs_mask(vis, OWNER, OTHER)


def test_owner_never_masked():
    for vis in ("busy", "public", "private"):
        assert not needs_mask(vis, OWNER, OWNER)


def test_public_never_masked():
    assert not needs_mask("public", OWNER, OTHER)


def test_mask_event_dict_masks_only_sensitive_fields():
    payload = {
        "id": "e1",
        "owner_id": str(OWNER),
        "title": "牙科复诊",
        "description": "带上次的片子",
        "location": "XX 医院",
        "color": "#ff0000",
        "visibility": "busy",
        "start_time": "2026-01-01T09:00:00+00:00",
        "end_time": "2026-01-01T10:00:00+00:00",
        "version": 7,
    }
    masked = mask_event_dict(payload, OTHER)
    assert masked["title"] == BUSY_MASK
    assert masked["description"] is None
    assert masked["location"] is None
    assert masked["color"] is None
    # 时间与版本仍需可见（用于占位显示与增量同步）
    assert masked["start_time"] == payload["start_time"]
    assert masked["version"] == 7
    # 入参不得被就地修改
    assert payload["title"] == "牙科复诊"


def test_mask_event_dict_noop_for_owner():
    payload = {"owner_id": str(OWNER), "title": "我的会议", "visibility": "busy"}
    assert mask_event_dict(payload, OWNER) is payload


# ---------- 广播分级 ----------
def test_payload_level_matrix():
    assert payload_level("public", OWNER, OTHER) == "full"
    assert payload_level("busy", OWNER, OTHER) == "masked"
    assert payload_level("private", OWNER, OTHER) == "skip"
    assert payload_level("private", OWNER, OWNER) == "full"
    assert payload_level("bussy", OWNER, OTHER) == "skip"
    assert payload_level("busy", OWNER, None) == "skip"


# ---------- owner 查询参数作用域 ----------
def test_resolve_owner_scope_none_and_empty_mean_unrestricted():
    assert resolve_owner_scope(None, OWNER) is None
    assert resolve_owner_scope("", OWNER) is None
    assert resolve_owner_scope("   ", OWNER) is None


def test_resolve_owner_scope_allows_self():
    assert resolve_owner_scope(str(OWNER), OWNER) == str(OWNER)


def test_resolve_owner_scope_denies_others():
    # 回归：旧实现在传 owner 时整体替换可见性过滤，可直接列出他人 private 事件
    with pytest.raises(ForbiddenError):
        resolve_owner_scope(str(OTHER), OWNER)


def test_resolve_owner_scope_rejects_invalid_uuid():
    with pytest.raises(InvalidError):
        resolve_owner_scope("not-a-uuid", OWNER)


# ---------- 乐观锁 / LWW ----------
def test_if_match_none_skips_check():
    assert if_match_conflicts(None, 9) is False


def test_if_match_zero_is_compared():
    # 回归：旧写法 `if if_match and ...` 让 If-Match: 0 跳过冲突检测
    assert if_match_conflicts(0, 0) is False
    assert if_match_conflicts(0, 5) is True


def test_if_match_conflict_and_match():
    assert if_match_conflicts(5, 5) is False
    assert if_match_conflicts(4, 5) is True


def test_if_match_invalid_type():
    with pytest.raises(InvalidError):
        if_match_conflicts("abc", 5)


def test_lww_stale_rules():
    assert lww_is_stale(3, 5) is True
    assert lww_is_stale(5, 5) is False
    assert lww_is_stale(6, 5) is False
    # 无版本号（离线首同步）不判陈旧
    assert lww_is_stale(None, 5) is False
    assert lww_is_stale(0, 5) is False
