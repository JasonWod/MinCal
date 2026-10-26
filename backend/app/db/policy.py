"""把 authz 策略落到 SQLAlchemy 查询条件。

任何“列出 / 拉取 / 同步事件”的查询都必须 AND 上 visible_to()，
避免出现某个接口忘记加过滤条件（这正是越权类缺陷的成因）。
"""
import uuid

from sqlalchemy import or_

from app.db.models import Event


def visible_to(viewer_id) -> object:
    """查看者可见范围：本人全部事件 + 他人的非 private 事件。"""
    uid = uuid.UUID(str(viewer_id))
    return or_(Event.owner_id == uid, Event.visibility != "private")


def owned_by(owner_id) -> object:
    uid = uuid.UUID(str(owner_id))
    return Event.owner_id == uid
