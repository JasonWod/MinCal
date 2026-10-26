"""HTTP 契约回归（无需真实数据库：覆盖 get_db，鉴权用替身）。

只验证“进入业务逻辑之前”的边界：401 / 403 / 422 / 400。
"""
import uuid

import pytest

pytest.importorskip("httpx", reason="需要 httpx（FastAPI TestClient 依赖）")

from fastapi.testclient import TestClient  # noqa: E402

from app.auth.deps import get_current_user  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402

START = "2026-11-01T01:00:00+00:00"
END = "2026-11-01T02:00:00+00:00"


class FakeUser:
    def __init__(self):
        self.id = uuid.uuid4()
        self.username = "tester"
        self.display_name = "Tester"
        self.email = None
        self.timezone = "Asia/Shanghai"
        self.color = "#4F46E5"


class FakeScalars:
    def all(self):
        return []


class FakeResult:
    def scalars(self):
        return FakeScalars()

    def scalar_one_or_none(self):
        return None


class FakeSession:
    """最小可用的 AsyncSession 替身：任何查询都返回空集。"""

    async def execute(self, *args, **kwargs):
        return FakeResult()

    async def commit(self):
        return None


@pytest.fixture()
def client():
    # 任何情况下都不允许触达真实数据库
    app.dependency_overrides[get_db] = lambda: FakeSession()
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def logged_in():
    user = FakeUser()
    app.dependency_overrides[get_current_user] = lambda: user
    return user


# ---------- 401：一律要求鉴权，且不得变成 500 ----------
def test_list_events_requires_auth(client):
    assert client.get("/events", params={"start": START, "end": END}).status_code == 401


def test_get_event_requires_auth(client):
    assert client.get(f"/events/{uuid.uuid4()}").status_code == 401


def test_create_event_requires_auth(client):
    payload = {"title": "x", "start_time": START, "end_time": END}
    assert client.post("/events", json=payload).status_code == 401


def test_sync_endpoints_require_auth(client):
    assert client.post("/sync/initial").status_code == 401
    assert client.get("/sync/pull", params={"since": 0}).status_code == 401
    assert client.post("/sync/push", json=[]).status_code == 401


def test_empty_bearer_token_is_401_not_500(client):
    assert client.get(
        "/events",
        params={"start": START, "end": END},
        headers={"Authorization": "Bearer "},
    ).status_code == 401


# ---------- 422：入参校验 ----------
def test_inverted_time_range_rejected(client, logged_in):
    payload = {"title": "倒排", "start_time": END, "end_time": START}
    assert client.post("/events", json=payload).status_code == 422


def test_unknown_visibility_rejected(client, logged_in):
    payload = {"title": "拼错", "start_time": START, "end_time": END, "visibility": "bussy"}
    assert client.post("/events", json=payload).status_code == 422


def test_blank_title_rejected(client, logged_in):
    payload = {"title": "    ", "start_time": START, "end_time": END}
    assert client.post("/events", json=payload).status_code == 422


def test_invalid_attendee_id_rejected(client, logged_in):
    payload = {
        "title": "带参与者",
        "start_time": START,
        "end_time": END,
        "attendees": ["not-a-uuid"],
    }
    assert client.post("/events", json=payload).status_code == 422


# ---------- 403：不得越权查他人列表 ----------
def test_owner_param_of_another_user_forbidden(client, logged_in):
    other = str(uuid.uuid4())
    r = client.get("/events", params={"start": START, "end": END, "owner": other})
    assert r.status_code == 403


def test_owner_param_of_self_allowed_shape(client, logged_in):
    r = client.get("/events", params={"start": START, "end": END, "owner": str(logged_in.id)})
    # get_db 返回 None，真正查询会在数据层失败；这里只要求不是 403
    assert r.status_code != 403


# ---------- 400：非法路径参数不得 500 ----------
def test_bad_uuid_path_returns_400(client, logged_in):
    assert client.get("/events/not-a-uuid").status_code == 400


# ---------- 健康检查 ----------
def test_health_reports_database_state(client):
    r = client.get("/health")
    assert r.status_code in (200, 503)
    body = r.json()
    assert body["service"] == "mincal"
    assert (r.status_code == 200) == (body.get("database") == "up")
