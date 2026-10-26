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
