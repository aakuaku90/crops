from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://andrewakuaku@localhost:5432/crops_db"
    ghana_country_code: str = "GHA"
    hdex_api_token: str = ""
    faostat_username: str = ""
    faostat_password: str = ""
    faostat_token: str = ""
    # Anthropic API key for the chat panel. Get from console.anthropic.com.
    # Without it the /chat endpoint returns 503.
    anthropic_api_key: str = ""

    class Config:
        env_file = "../.env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
