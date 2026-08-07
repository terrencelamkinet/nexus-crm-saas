from contextlib import asynccontextmanager
import asyncio
import os
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
    # Startup: ensure nexus_auth and nexus_crm schemas exist.
    # IMPORTANT: with gunicorn --preload + N workers, lifespan runs once per
    # worker. create_all uses checkfirst (no-op when tables exist), but 4
    # workers racing the initial DDL can deadlock on table locks. Use a
    # file-based lock so only the first worker does DDL; others skip.
    ddl_lock = "/tmp/nexus_crm_ddl.lock"
    acquired = False
    try:
        os.makedirs("/tmp", exist_ok=True)
        fd = os.open(ddl_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
        acquired = True
    except FileExistsError:
        acquired = False
    if acquired:
        try:
            async with engine.begin() as conn:
                from sqlalchemy import text
                await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_auth"))
                await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_crm"))
                await conn.run_sync(Base.metadata.create_all)
        finally:
            try:
                os.remove(ddl_lock)
            except OSError:
                pass

    # Telegram inbound: webhook mode (production) OR getUpdates poller (fallback)
    if not settings.tg_use_webhook:
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
    else:
        # Webhook mode: spawn Redis queue consumers (one per worker).
        # BRPOP guarantees each update goes to exactly one worker.
        from app.services.telegram_inbound import webhook_queue_consumer
        queue_stop = asyncio.Event()
        queue_task = asyncio.create_task(webhook_queue_consumer(queue_stop))

    # Daily Briefing scheduler — every 15 min, single worker (file lock so the
    # N gunicorn workers don't all run it). Honors IMDeliveryPref channel gate
    # + weekend_mute + quiet_hours; per-user greeting_slots decide timing.
    if not settings.briefing_scheduler_enabled:
        briefing_task = None
    else:
        _sched_lock = "/tmp/nexus_crm_briefing.lock"
        brief_owner = False
        try:
            fd = os.open(_sched_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            brief_owner = True
        except FileExistsError:
            brief_owner = False

        briefing_stop = asyncio.Event()

        async def _briefing_loop():
            from app.services.briefing_scheduler import run_scheduler
            import logging as _blog
            while not briefing_stop.is_set():
                try:
                    stats = await run_scheduler()
                    _blog.getLogger("briefing_scheduler").info(
                        "run: %s due, %s sent, %s skipped, %s failed (%s scanned)",
                        stats.get("due"), stats.get("sent"), stats.get("skipped"),
                        stats.get("failed"), stats.get("scanned"),
                    )
                except Exception as e:  # noqa: BLE001 — must never crash the app
                    _blog.getLogger("briefing_scheduler").exception(
                        "run_scheduler crashed: %s", e
                    )
                try:
                    await asyncio.wait_for(briefing_stop.wait(), timeout=15 * 60)
                except asyncio.TimeoutError:
                    continue

        if brief_owner:
            briefing_task = asyncio.create_task(_briefing_loop())
        else:
            briefing_task = None

    yield
    if not settings.tg_use_webhook:
        poller_stop.set()
        try:
            await asyncio.wait_for(poller_task, timeout=5)
        except Exception:
            pass
    else:
        queue_stop.set()
        try:
            await asyncio.wait_for(queue_task, timeout=5)
        except Exception:
            pass
    if briefing_task:
        try:
            briefing_stop.set()
            await asyncio.wait_for(briefing_task, timeout=5)
        except Exception:
            pass
        try:
            os.remove(_sched_lock)
        except OSError:
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
