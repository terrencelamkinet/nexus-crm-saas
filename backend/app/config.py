from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "NEXUS CRM Auth"
    debug: bool = True
    # Public-facing base URL (for OAuth redirect URIs behind cloudflared).
    # Set in production .env: PUBLIC_BASE_URL=https://nexus-crm.kinet-poc.com
    public_base_url: str = ""

    # Database — via PgBouncer (transaction pool, port 6432) for 50k-scale
    # connection multiplexing. Direct 5432 fallback kept in comments.
    #   direct: postgresql+asyncpg://gg_fighter:...@127.0.0.1:5432/nexus_crm
    database_url: str = "postgresql+asyncpg://gg_fighter:F5xbTAzODUVEU4KDDIP@127.0.0.1:6432/nexus_crm"

    # JWT — RS256 asymmetric for tenant security
    jwt_private_key_path: str = "keys/private.pem"
    jwt_public_key_path: str = "keys/public.pem"
    jwt_algorithm: str = "RS256"
    access_token_expire_minutes: int = 1440  # 24h (was 15min)
    refresh_token_expire_days: int = 1

    # PgBouncer (transaction pool) — same URL as database_url; kept for
    # components that need the dedicated nexus_app role (e.g. migrations).
    app_database_url: str = "postgresql+asyncpg://nexus_app:NexusApp2026Secure!@127.0.0.1:6432/nexus_crm"

    # Briefing scheduler — BYPASSRLS role so it can scan ALL users' settings.
    briefing_database_url: str = ""  # NEXUS_BRIEFING_DATABASE_URL
    briefing_scheduler_enabled: bool = True  # NEXUS_BRIEFING_SCHEDULER_ENABLED (default ON — Daily Briefing live)

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

    # AI Provider keys
    deepseek_api_key: str = ""
    gemini_api_key: str = ""

    # Geo — address autocomplete / reverse geocoding（server-side proxy）
    geo_provider: str = "auto"   # auto（有 key 用 geoapify，冇用 photon）| photon | geoapify
    geoapify_api_key: str = ""   # GEOAPIFY_API_KEY — free 3000 req/day

    # WhatsApp Cloud API
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_webhook_verify_token: str = ""
    tg_webhook_secret: str = ""       # NEXUS_TG_WEBHOOK_SECRET — validates X-Telegram-Bot-Api-Secret-Token
    tg_use_webhook: bool = False      # NEXUS_TG_USE_WEBHOOK — true = webhook mode (poller disabled)
    whatsapp_app_secret: str = ""
    whatsapp_template_name: str = ""  # NEXUS_WHATSAPP_TEMPLATE_NAME — approved Meta template for 24h-window fallback

    # Integration / OAuth
    api_base_url: str = "http://localhost:8001"
    integration_client_ids: dict = {
        "google_calendar": "",
        "outlook_calendar": "",
        "gmail": "",
        "outlook_mail": "",
        "slack": "",
        "zoom": "",
        "whatsapp": "",
        "teams": "",
        "google_drive": "",
        "dropbox": "",
        "onedrive": "",
        "linkedin": "",
        "facebook": "",
        "notion": "",
        "stripe": "",
        "quickbooks": "",
        "mailchimp": "",
        "hubspot": "",
    }

    cron_api_key: str = ""  # Cron-Api-Key for scheduled jobs (NEXUS_CRON_API_KEY)

    model_config = {"env_prefix": "NEXUS_", "env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

settings = Settings()
