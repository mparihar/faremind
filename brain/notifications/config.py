from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # env_file is only used locally; Railway injects env vars directly
    model_config = SettingsConfigDict(env_file="../../.env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = ""

    # Brevo (email provider)
    brevo_api_key: str = ""
    brevo_sender_email: str = "support@faremind.ai"
    brevo_sender_name: str = "FareMind"

    # App
    app_url: str = "http://localhost:3000"
    support_email: str = "gayatri.parihar@gmail.com"

    # Service
    port: int = 8001
    debug: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
