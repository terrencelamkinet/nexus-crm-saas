# G08 NEXUS CRM — Production Architecture Blueprint

> v1.0 · 2026-07-09 · Design: modular monolith, extraction-ready

---

## 1. Architecture Principles

| Principle | Rule |
|-----------|------|
| **Modular monolith first** | One deployable package, clear bounded contexts → extract later by swapping module |
| **Extraction-ready** | Every module has a well-defined API boundary. Extract = deploy separate instance + point DNS |
| **API-first auth** | Tokens not localStorage. JWT access (15min) + refresh (7d HTTP-only cookie) |
| **Background by default** | OCR, email, calendar sync → Redis queue, never inline request-response |
| **Tenant-aware from day 1** | Every API call carries `X-Tenant-ID`. Repository layer filters by tenant |
| **PgBouncer upfront** | Transaction pooling to prevent connection exhaustion at 1000 users |
| **Componentized frontend** | React + TypeScript + shadcn/ui design system. No more single-file HTML |

---

## 2. Module Map (Extraction Boundaries)

```
nexus-crm.kinet-poc.com
├── /                  Product landing pages (static HTML)     ← Can move to CDN
├── /login/            Auth portal (static + JS → API calls)   ← Bundled with auth-svc
├── /portal/           CRM SPA (React build)                   ← Can move to separate host
├── /api/v1/auth/*     Auth service                            ← Can extract → auth.nexus-crm.com
├── /api/v1/crm/*      CRM API                                 ← Can extract → crm.nexus-crm.com
└── /api/v1/sync/*     Background job triggers                 ← Can extract → worker.nexus-crm.com
```

### Extraction Trigger Conditions

| Module | Extraction trigger | New host |
|--------|-------------------|----------|
| Auth | >500 concurrent users | auth.nexus-crm.com |
| Portal SPA | >200 daily active users | app.nexus-crm.com → separate build + CDN |
| CRM API | >50 API req/s sustained | api.nexus-crm.com |
| Background workers | >10K jobs/day | worker.nexus-crm.com |

**Extraction = no code change.** Each module already uses `config.API_BASE_URL` — just change env var.

---

## 3. Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend | React + TypeScript | 19.x / 6.x | shadcn/ui design system |
| Backend | FastAPI | 0.115+ | async endpoints, Pydantic v2 |
| API Gateway | Vite middleware (dev) → Nginx (prod) | — | Routes: / → static, /api/ → FastAPI |
| Database | PostgreSQL | 16 | Task Hub + NEXUS data |
| Connection Pool | PgBouncer | latest | Transaction mode |
| Cache / Queue | Redis | 8-alpine | OTP cache, job queue, session store |
| Background Workers | ARQ (Redis-based) | — | OCR, email, calendar sync |
| Auth | JWT + refresh tokens | — | email MFA via SMTP OTP |
| Deployment | Docker Compose → cloudflared tunnel | — | Single Mac Mini first |
| Monitoring | Sentry + Prometheus | — | Phase 2 |

---

## 4. Auth Flow

```
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌────────┐
│ Product   │      │ Auth API │      │  Redis   │      │  PG    │
│  Page     │      │ /api/v1/ │      │  (OTP)   │      │(Users) │
│           │      │   auth/  │      │          │      │        │
└────┬─────┘      └────┬─────┘      └────┬─────┘      └───┬────┘
     │  1. POST /login │                 │                 │
     │  {email, pw}   │                 │                 │
     ├────────────────→│  2. Verify hash │                 │
     │                 │─────────────────│────────────────→│
     │                 │  3. Hash match ✅│                │
     │  4. Send OTP    │                 │                 │
     │ ←───────────────│  5. Store OTP   │                 │
     │                 ├────────────────→│                 │
     │  6. Enter OTP   │                 │                 │
     ├────────────────→│  7. Verify OTP  │                 │
     │                 ├────────────────→│                 │
     │  8. JWT pair    │                 │                 │
     │ ←───────────────┤                 │                 │
     │  access(15m)    │                 │                 │
     │  refresh(7d     │                 │                 │
     │   HTTP-only)    │                 │                 │
     │                 │                 │                 │
     │  9. Portal call │                 │                 │
     ├────────────────→│  Validate JWT   │                 │
     │  with Bearer    ├─── (stateless) ─┤                 │
```

### Token Structure

```json
// Access Token (15 min)
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "email": "user@example.com",
  "role": "admin",
  "exp": 1741526400,
  "iat": 1741525500
}

// Refresh Token (7 days, HTTP-only Secure SameSite=Strict cookie)
{
  "sub": "user-uuid",
  "type": "refresh",
  "exp": 1742131200,
  "jti": "unique-token-id"  // → Redis blacklist on logout
}
```

---

## 5. Database Schema

### nexus_auth schema (separate schema for extraction readiness)

```sql
-- Schema: nexus_auth (can be moved to separate PG instance)
CREATE SCHEMA IF NOT EXISTS nexus_auth;

CREATE TABLE nexus_auth.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,          -- bcrypt
    display_name    TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT,
    email_verified  BOOLEAN DEFAULT FALSE,
    mfa_enabled     BOOLEAN DEFAULT TRUE,
    role            TEXT DEFAULT 'member',  -- admin | member | viewer
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE nexus_auth.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES nexus_auth.users(id) ON DELETE CASCADE,
    refresh_token   TEXT UNIQUE NOT NULL,
    user_agent      TEXT,
    ip_address      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE nexus_auth.mfa_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES nexus_auth.users(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,            -- 6-digit
    purpose         TEXT DEFAULT 'login',     -- login | email_change
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### nexus_crm schema (core data)

```sql
CREATE SCHEMA IF NOT EXISTS nexus_crm;

CREATE TABLE nexus_crm.tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    subdomain       TEXT UNIQUE,              -- tenant.nexus-crm.com
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE nexus_crm.tenant_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES nexus_crm.tenants(id),
    user_id         UUID NOT NULL REFERENCES nexus_auth.users(id),
    role            TEXT DEFAULT 'member',
    UNIQUE(tenant_id, user_id)
);

-- Future: companies, contacts, deals, projects, touchpoints, tasks...
```

---

## 6. API Module Structure

```
backend/
├── app/
│   ├── main.py                  FastAPI app, middleware, CORS
│   ├── config.py                Pydantic Settings (env-driven)
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py              User, Session ORM models
│   │   └── tenant.py            Tenant, TenantMember
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py              LoginRequest, TokenResponse, MFAVerify
│   │   └── user.py              UserCreate, UserOut
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── auth.py              POST /login, /verify-mfa, /refresh, /logout
│   │   └── users.py             GET /me, PATCH /me
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth.py              Hash, JWT, OTP generation
│   │   ├── email.py             Send OTP via SMTP
│   │   └── tenant.py            Tenant resolution
│   ├── middleware/
│   │   ├── __init__.py
│   │   └── auth.py              JWT validation, tenant extraction
│   └── db.py                    AsyncSession, engine, get_db
├── alembic/                     Migrations
│   ├── env.py
│   └── versions/
├── requirements.txt
├── Dockerfile
└── pyproject.toml
```

---

## 7. Deployment Topology (Phase 1)

```
                            Cloudflare
                                │
                     nexus-crm.kinet-poc.com
                                │
                     cloudflared tunnel
                                │
                        ┌───────┴───────┐
                        │    localhost   │
                        │     :5173      │
                        │   Vite (dev)   │
                        │                │
                        │  Middleware    │
                        │  / → public/   │
                        │  /login/ →     │
                        │  /portal/ →    │
                        │  /api/* →      │
                        │   :8001/       │
                        └───────┬───────┘
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
            FastAPI Auth               PostgreSQL 16
            localhost:8001             localhost:5432
            /api/v1/auth/*                     │
                                       PgBouncer
                                       localhost:6432
                  │
             Redis 8
            localhost:6379
            (OTP cache + session store)

  Background Workers (ARQ):
    ┌───────────────────────────────┐
    │ worker-ocr     (名卡 scan)    │
    │ worker-email   (MFA OTP send) │
    │ worker-sync    (Gmail sync)   │
    │ worker-cal     (Calendar sync)│
    └───────────────────────────────┘
```

---

## 8. Phase 1 / Phase 2 Roadmap

### Phase 1 — Foundation (你嘅而家)

| Item | Status |
|------|--------|
| Product landing pages (7 pages) | ✅ Deployed |
| Login button on all pages | ✅ Done |
| Login portal (UI shell) | ✅ At /login/ |
| CRM portal (design02) | ✅ At /portal/ |
| **Auth backend (FastAPI)** | 🔨 Building |
| Auth portal → API integration | ⏳ Next |
| DB migration (users, tenants) | ⏳ Next |
| Email MFA (SMTP OTP) | ⏳ Next |
| JWT token management | ⏳ Next |
| PgBouncer setup | ⏳ Next |
| Redis install + config | ⏳ Next |

### Phase 1.5 — Multi-tenant

| Item | Est. effort |
|------|-------------|
| Tenant registration flow | 2 days |
| Tenant-member invite system | 1 day |
| Role-based access (admin/member/viewer) | 1 day |
| Tenant data isolation (RLS / repository pattern) | 2 days |

### Phase 2 — Scale

| Item | Est. effort |
|------|-------------|
| Background workers (ARQ) | 2 days |
| Gmail sync (background) | 2 days |
| Calendar sync (background) | 1 day |
| OCR pipeline (background) | 2 days |
| Nginx reverse proxy (production) | 1 day |
| Docker Compose full stack | 1 day |
| Separate auth.nexus-crm.com (if needed) | 0.5 day |
| Prometheus + Grafana | 1 day |

### Phase 3 — Extraction

| Item | Trigger |
|------|---------|
| Auth → auth.nexus-crm.com | >500 concurrent users |
| Portal → app.nexus-crm.com CDN | >200 DAU |
| CRM API → api.nexus-crm.com | >50 req/s |
| Workers → worker.nexus-crm.com | >10K jobs/day |

---

## 9. Sizing Assumptions (1000 Users)

| Resource | Per user | Total for 1000 |
|----------|----------|----------------|
| API req/s | 0.1 avg | 100 req/s |
| DB connections (via PgBouncer) | — | 50 pool |
| Redis memory (OTP + session) | ~2KB | ~50MB |
| File storage (avatars + OCR) | ~10MB | ~10GB |
| RAM (FastAPI + Workers + Redis) | — | ~4GB |
| Disk (PG data) | ~5MB | ~5GB + WAL |

**Mac Mini M4 Pro (24GB RAM / 512GB SSD) =** comfortably handles Phase 1-2.

---

## 10. Security

| Layer | Measure |
|-------|---------|
| Password | bcrypt (cost=12) |
| OTP | 6 digits, 5 min expiry, rate-limited per email |
| JWT | RS256 with rotation, 15min access + 7d refresh |
| Refresh token | HTTP-only, Secure, SameSite=Strict |
| Session | Redis blacklist on logout |
| DB | Prepared statements, parameterized queries |
| API | Rate limiting (100 req/min per IP unauthed) |
| CORS | Whitelist only nexus-crm.kinet-poc.com |
| Encryption | TLS via Cloudflare tunnel |
