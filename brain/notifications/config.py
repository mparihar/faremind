from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    # Database
    database_url: str = ""

    # Email provider — Brevo by default
    email_provider: str = "brevo"
    brevo_api_key: str = ""
    brevo_sender_email: str = "noreply@faremind.com"
    brevo_sender_name: str = "FareMind"

    # SendGrid (optional fallback)
    sendgrid_api_key: str = ""

    # App
    app_url: str = "http://localhost:3000"
    support_email: str = "gayatri.parihar@gmail.com"

    # Service
    port: int = 8001
    debug: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
