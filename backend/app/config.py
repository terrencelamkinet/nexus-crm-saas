from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "NEXUS CRM Auth"
    debug: bool = True

    # Database
    database_url: str = "postgresql+asyncpg://gg_fighter:F5xbTAzODUVEU4KDDIP@127.0.0.1:5432/nexus_crm"

    # JWT — RS256 asymmetric for tenant security
    jwt_private_key_path: str = "keys/private.pem"
    jwt_public_key_path: str = "keys/public.pem"
    jwt_algorithm: str = "RS256"
    access_token_expire_minutes: int = 1440  # 24h (was 15min)
    refresh_token_expire_days: int = 1

    # PgBouncer (transaction pool)
    app_database_url: str = "postgresql+asyncpg://nexus_app:NexusApp2026Secure!@127.0.0.1:6432/nexus_crm"

    # Redis (for OTP cache)
    redis_url: str = "redis://127.0.0.1:6379/0"

    # Email (SMTP for OTP)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    mfa_from_email: str = "noreply@nexus-crm.com"

    # CORS
    allowed_origins: str = "http://localhost:5173,https://nexus-crm.kinet-poc.com"

    model_config = {"env_prefix": "NEXUS_"}

settings = Settings()
