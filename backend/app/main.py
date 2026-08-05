from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import engine, Base
from app.models import User, Session, Tenant, TenantMember  # Register all models
from app.models.crm import Company, Contact, Touchpoint, Task, NameCard, Note, ActivityLog, Tag  # Register CRM models
from app.models.crm_module_b import DealPipeline, DealStage, Deal, Product, DealLineItem, Quote, QuoteItem, SalesReport, ModuleSetting  # Register Module B models
from app.models.crm_module_c import AiDraft, Expense, PersonalNote  # Register Batch B/C module models
from app.models.notification import Notification, NotificationPreference  # Register Notification models
from app.models.dashboard_layout import DashboardLayout  # Register Dashboard layout model
from app.models.integration import Integration, OAuthState  # Register Integration models
from app.models.whatsapp import WhatsAppMapping, WhatsAppOTP  # Register WhatsApp models
from app.models.telegram_bot import TelegramBotMapping  # Register Telegram models
from app.models.im_push import IMDeliveryPref, PushLog  # Register IM Push models
from app.models.oauth_client import OAuthClientSetting  # Register OAuth client settings model
from app.models.ai import Agent, AISession, Message, Tool, ActionRequest, Quota, UsageEvent, ModelProfile, ProviderCredential, ProviderHealth, SecretarySettings, ChannelCredential  # Register AI models
from app.middleware.tenant import TenantMiddleware
from app.middleware.ai_session import AISessionMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure nexus_auth and nexus_crm schemas exist
    async with engine.begin() as conn:
        from sqlalchemy import text
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_auth"))
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_crm"))
        await conn.run_sync(Base.metadata.create_all)

    # Telegram inbound: webhook mode (production) OR getUpdates poller (fallback)
    if not settings.tg_use_webhook:
        import asyncio
        from app.services.telegram_inbound import poll_once

        poller_stop = asyncio.Event()

        async def _tg_poll_loop():
            from app.db import async_session
            import logging as _logging
            while not poller_stop.is_set():
                try:
                    async with async_session() as db:
                        await poll_once(db)
                except Exception as e:  # noqa: BLE001 — poller must never crash the app, but must NOT be silent
                    _logging.getLogger("telegram_inbound").exception(
                        "poll_once crashed: %s", e
                    )
                try:
                    await asyncio.wait_for(poller_stop.wait(), timeout=1)
                except asyncio.TimeoutError:
                    continue

        poller_task = asyncio.create_task(_tg_poll_loop())

    yield
    if not settings.tg_use_webhook:
        poller_stop.set()
        try:
            await asyncio.wait_for(poller_task, timeout=5)
        except Exception:
            pass
    await engine.dispose()

app = FastAPI(title=settings.app_name, lifespan=lifespan)

# CORS
origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AISessionMiddleware)
app.add_middleware(TenantMiddleware)

# Mount routers
from app.routers import auth
from app.routers import crm
from app.routers import crm_module_b
from app.routers import crm_module_settings
from app.routers import crm_module_c
from app.routers import crm_notifications
from app.routers import crm_todo
from app.routers import dashboard_layout
from app.routers import crm_integrations
from app.routers import admin_oauth
from app.routers import whatsapp
from app.routers import telegram
app.include_router(auth.router)
app.include_router(crm.router)
app.include_router(crm_module_b.router)
app.include_router(crm_module_settings.router)
app.include_router(crm_notifications.router)
app.include_router(crm_todo.router)
app.include_router(dashboard_layout.router)
app.include_router(crm_module_c.router)
app.include_router(crm_integrations.router)
app.include_router(admin_oauth.router)
app.include_router(whatsapp.router)
app.include_router(telegram.router)
from app.routers import im_push
app.include_router(im_push.router)
from app.routers import ai
from app.routers import ai_rag
app.include_router(ai.router)
app.include_router(ai_rag.router)
from app.routers import ai_secretary
app.include_router(ai_secretary.router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-auth"}
