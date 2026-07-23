from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import engine, Base
from app.models import User, Session, Tenant, TenantMember  # Register all models
from app.models.crm import Company, Contact, Touchpoint, Task, NameCard, Note, ActivityLog, Tag  # Register CRM models
from app.models.crm_module_b import DealPipeline, DealStage, Deal, Product, DealLineItem, Quote, QuoteItem, SalesReport, ModuleSetting  # Register Module B models
from app.middleware.tenant import TenantMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure nexus_auth and nexus_crm schemas exist
    async with engine.begin() as conn:
        from sqlalchemy import text
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_auth"))
        await conn.execute(text("CREATE SCHEMA IF NOT EXISTS nexus_crm"))
        await conn.run_sync(Base.metadata.create_all)
    yield
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
app.add_middleware(TenantMiddleware)

# Mount routers
from app.routers import auth
from app.routers import crm
from app.routers import crm_module_b
from app.routers import crm_module_settings
from app.routers import crm_module_c
app.include_router(auth.router)
app.include_router(crm.router)
app.include_router(crm_module_b.router)
app.include_router(crm_module_settings.router)
app.include_router(crm_module_c.router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nexus-auth"}
