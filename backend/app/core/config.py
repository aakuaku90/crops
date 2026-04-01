from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://andrewakuaku@localhost:5432/crops_db"
    ghana_country_code: str = "GHA"
    hdex_api_token: str = ""
    faostat_username: str = ""
    faostat_password: str = ""
    faostat_token: str = ""

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
