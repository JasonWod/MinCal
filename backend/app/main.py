import logging
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.auth.router import router as auth_router
from app.events.router import router as events_router
from app.sync.router import router as sync_router
from app.authz import PolicyError
from app.config import get_settings
from app.db.init_db import init_db
from app.db.session import engine

settings = get_settings()
logger = logging.getLogger("mincal")

app = FastAPI(title="MinCal Server", version="0.1.0")

# --- CORS（F-13）---
# 通配来源 + allow_credentials 既违反 CORS 规范（浏览器直接拒绝带凭证请求），
# 也会放大跨站读取风险，因此通配时强制关闭凭证。
raw_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
allow_all_origins = "*" in raw_origins
if allow_all_origins:
    logger.warning(
        "CORS 配置为 '*'：已强制 allow_credentials=False，生产环境请显式列出来源白名单"
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=raw_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 策略异常统一转 HTTP（避免落到 500）---
@app.exception_handler(PolicyError)
async def policy_error_handler(request: Request, exc: PolicyError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


class TokenScrubbingFilter(logging.Filter):
    """把日志里的 token=xxx 脱敏。

    WebSocket 无法自定义请求头，只能走查询参数，这里兜底避免令牌落入访问日志。
    """

    _pattern = re.compile(r"(token=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "token=" in message:
            record.msg = self._pattern.sub(r"\1***", message)
            record.args = ()
        return True


logging.getLogger("uvicorn.access").addFilter(TokenScrubbingFilter())

# Routers
app.include_router(auth_router, prefix="/auth")
app.include_router(events_router)
app.include_router(sync_router)


@app.on_event("startup")
async def startup():
    try:
        await init_db()
    except Exception as e:
        logger.warning(f"DB not ready yet: {e}. Will retry on first request.")


@app.get("/health")
async def health():
    """健康检查带数据库探活（F-17）。

    DB 不可用时返回 503，避免容器编排把“进程活着”误判为“服务健康”。
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"health: 数据库不可用: {exc}")
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "service": "mincal", "database": "down"},
        )
    return {"status": "ok", "service": "mincal", "database": "up"}
