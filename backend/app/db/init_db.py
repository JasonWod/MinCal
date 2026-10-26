"""
Init DB - create tables and sequences.
"""
from sqlalchemy import text
from app.db.session import engine
from app.db.models import Base


async def init_db():
    """Create tables if not exist."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "CREATE SEQUENCE IF NOT EXISTS event_version_seq START 1 INCREMENT 1 NO MAXVALUE"
        ))


async def next_version() -> int:
    async with engine.begin() as conn:
        result = await conn.execute(text("SELECT nextval('event_version_seq')"))
        return result.scalar_one()
