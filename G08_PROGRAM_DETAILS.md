# NEXUS CRM (G08) — Program Details for Platform Design

**Version:** v4.0+ (iterative, no formal version tracking)
**Status:** Active Development
**Server:** GG Fighter VM (local), Production at `nexus-crm.kinet-poc.com`
**Repo:** `terrencelamkinet/nexus-crm-saas` (branch: `master`)

---

## 1. System Overview

**NEXUS CRM** is a full-stack SaaS CRM for sales professionals. Multi-tenant, isolated per tenant with JWT auth + Row-Level Security. Built as a modular platform where each module (contacts, companies, deals, projects, tasks) can be individually enabled/disabled per tenant.

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 + TypeScript 6 + Vite 8 | SPA with React Router v7 |
| Styling | Tailwind CSS v4 + Custom CSS (index.css) | Custom design token system (`--color-*` variables) |
| Backend | FastAPI + SQLAlchemy 2.x async | Auto-creates tables on startup (no Alembic) |
| Database | PostgreSQL 16 | Two schemas: `nexus_auth` + `nexus_crm` |
| Auth | JWT Bearer tokens + MFA (OTP) | Dev bypass: `/api/v1/auth/dev-login` |
| Server Ports | Backend: 8001, Frontend: 5173/5174 | Production tunnel via cloudflared → :5174 |
| Frontend Dependencies | react, react-router-dom, lucide-react, moment | Minimal — zero heavy UI framework |

---

## 2. Project Structure

```
nexus-crm-saas/
├── backend/
│   ├── app/
│   │   ├── main.py              ← FastAPI app, lifespan, router includes
│   │   ├── config.py             ← Settings from env vars
│   │   ├── db.py                 ← Async engine, session factory, tenant session
│   │   ├── middleware/
│   │   │   └── tenant.py         ← JWT decode + tenant_id resolution
│   │   ├── models/
│   │   │   ├── __init__.py       ← Auth models (User, Session, Tenant, TenantMember)
│   │   │   ├── crm.py            ← Company, Contact, Touchpoint, Task, NameCard, Note, ActivityLog, Tag
│   │   │   ├── crm_module_b.py   ← Deal, DealStage, DealPipeline, Product, etc.
│   │   │   ├── crm_module_c.py   ← Project, ProjectStage, ProjectContact, etc.
│   │   │   ├── dashboard_layout.py
│   │   │   └── notification.py
│   │   ├── routers/
│   │   │   ├── auth.py           ← Register, login, MFA, refresh, dev-login
│   │   │   ├── crm.py            ← Module A: companies, contacts, touchpoints, tasks, notes, name-cards, tags, activity-log
│   │   │   ├── crm_module_b.py   ← Module B: deals, pipelines, stages, products, quotes
│   │   │   ├── crm_module_c.py   ← Module C: projects, stages, calendar events
│   │   │   ├── crm_module_settings.py
│   │   │   ├── crm_notifications.py
│   │   │   └── dashboard_layout.py
│   │   ├── schemas/              ← Pydantic models (request/response)
│   │   ├── services/
│   │   │   ├── auth_service.py   ← Password hashing, JWT, refresh logic
│   │   │   ├── email_service.py
│   │   │   └── redis_service.py
│   │   └── docs/
│   │       └── ARCHITECTURE.md   ← 10 immutable rules (personal + team workspace)
│   ├── migrations/               ← SQL migration files
│   └── scripts/                  ← Admin scripts (dev-login, data import, migration)
├── src/
│   ├── main.tsx                  ← React entry point
│   ├── App.tsx                   ← Router config (all routes)
│   ├── index.css                 ← Global CSS + design tokens + utility classes
│   ├── lib/
│   │   ├── api.ts                ← HTTP client with JWT handling + auto-refresh
│   │   ├── AuthContext.tsx        ← React context for auth state
│   │   └── ...
│   ├── components/
│   │   ├── Layout.tsx             ← App shell: Header + Sidebar + content area
│   │   ├── Header.tsx             ← Topbar: dark mode, notification bell, user menu, mobile hamburger
│   │   ├── Sidebar.tsx            ← Nav menu (module-aware), mobile drawer
│   │   ├── AuthGuard.tsx          ← Route protection
│   │   ├── SlideDrawer.tsx        ← Right-side detail drawer (portal)
│   │   ├── BottomSheet.tsx        ← iOS-safe bottom sheet modal
│   │   ├── QuickAddTouchpoint.tsx
│   │   ├── QuickAddTask.tsx
│   │   ├── DashboardPreview.tsx   ← Legacy dashboard component
│   │   └── DnDSortableGroup.tsx   ← Pointer Events drag-and-drop
│   ├── pages/
│   │   ├── DashboardNew.tsx       ← Main dashboard (design01 standalone shell)
│   │   ├── LoginPage.tsx
│   │   ├── DealsPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── ...
│   ├── modules/                   ← Module-based entity pages
│   │   ├── GenericListPage.tsx     ← Reusable list with search/filter/sort
│   │   ├── GenericDetailPage.tsx   ← Reusable detail with tabs
│   │   ├── module-types.ts        ← Module configuration types
│   │   ├── enabled-modules.ts     ← Runtime module registry
│   │   ├── contacts/, companies/, projects/, tasks/, touchpoints/
│   │   │   ├── config.ts          ← Module config (columns, fields, options)
│   │   │   ├── *Page.tsx          ← List page
│   │   │   ├── *DetailPage.tsx    ← Detail page
│   │   │   └── *DetailTabs.tsx    ← Tab content
│   │   ├── shared/
│   │   │   ├── FieldsRenderer.tsx  ← Form field rendering + floating labels
│   │   │   ├── EntitySearch.tsx    ← Searchable autocomplete
│   │   │   ├── DetailDrawerContent.tsx ← Detail inside slide drawer
│   │   │   └── MobileSection.tsx
│   │   └── projects/CalendarViews/ ← Custom calendar (Month/Week/Day/Deadline/Gantt)
│   └── styles/
│       └── dashboard.css           ← Design01 dashboard CSS (scoped under .dash01-shell)
├── vite.config.ts
├── package.json
└── public/design01/               ← Static design reference (HTML/CSS)
```

---

## 3. Backend Architecture

### 3.1 Auth Flow

```
register/login → POST /api/v1/auth/login
  → JWT issued (includes sub=user_id, tenant_id in payload)
  → Frontend stores in localStorage as 'nexus_crm_auth'
  → Every API call includes Header: Authorization Bearer <token>

TenantMiddleware (runs on every request):
  → Reads JWT from Authorization header
  → Decodes token (verifies signature + expiry)
  → Sets request.state.tenant_id (from token payload)
  → Sets request.state.user_id (from token 'sub')
  → If expired → sets auth_status='expired' → endpoints return 401
  → If no token → tenant_id='' → endpoints return 403 "Tenant not identified"

Database session (db.py, get_tenant_session):
  → Before each request: SET app.tenant_id = request.state.tenant_id
  → This enables RLS policies to filter by tenant_id
```

**Dev login:** `POST /api/v1/auth/dev-login { "email": "terrence_lam@kinetix.com.hk", "password": "test123" }` — skips MFA.

**Tenant IDs:**
- Kinetix: `ba131d4d-fc6d-43e2-adc0-f656bd4fa7e4`
- Terrence user: `a77d12c5-35f4-442c-88ac-75eeb25e9985`
- Dev/test tenant: `00000000-0000-0000-0000-000000000001`

### 3.2 Tenant Isolation

**Two-level model** (from ARCHITECTURE.md):
1. **Personal workspace** — auto-created per user on registration
2. **Team workspace** — optional, max 1 team per user

Context switching via `X-Context` header: `"personal"` | `"team"`

**RLS Pattern:**
```sql
ALTER TABLE nexus_crm.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexus_crm.contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contacts ON nexus_crm.contacts
    FOR ALL USING (tenant_id = current_setting('app.tenant_id')::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
```

Currently 37 of 79 tables have RLS enabled. Core tables (companies, contacts, tasks, touchpoints, deals, projects, activity_log) have RLS + FORCE RLS.

### 3.3 API Routes

#### Module A — CRM Core (`/api/v1/crm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/crm/companies` | List (paginated, searchable) |
| POST | `/api/v1/crm/companies` | Create |
| GET/PATCH/DELETE | `/api/v1/crm/companies/{id}` | Read/Update/Delete |
| GET/POST/PATCH/DELETE | `/api/v1/crm/contacts/{id}` | Same pattern |
| GET/POST/PATCH/DELETE | `/api/v1/crm/touchpoints` | Same pattern |
| GET/POST/PATCH/DELETE | `/api/v1/crm/tasks` | Same pattern |
| GET/POST/PATCH/DELETE | `/api/v1/crm/name-cards` | Same pattern |
| GET/POST/PATCH/DELETE | `/api/v1/crm/notes` | Same pattern |
| GET/POST/PATCH/DELETE | `/api/v1/crm/tags` | Same pattern |
| GET/POST | `/api/v1/crm/activity-log` | Audit log (read-only for non-write) |

#### Module B — Sales (`/api/v1/crm`)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/v1/crm/deals` | Deal CRUD |
| GET/POST/PATCH | `/api/v1/crm/deal-pipelines` | Pipeline config |
| GET/POST/PATCH | `/api/v1/crm/deal-stages` | Stage definitions |
| GET/POST/PATCH | `/api/v1/crm/products` | Product catalog |
| GET/POST/PATCH | `/api/v1/crm/quotes` | Quote management |
| GET/POST | `/api/v1/crm/contact-projects` | Contact↔Deal junction |

#### Module C — Projects

| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH | `/api/v1/crm/projects` | Project CRUD |
| GET/POST/PATCH | `/api/v1/crm/project-stages` | Stage definitions |
| GET/POST/PATCH | `/api/v1/crm/project-calendar-events` | Milestones/events |

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login (returns mfa_required or token) |
| POST | `/api/v1/auth/send-mfa` | Send OTP |
| POST | `/api/v1/auth/verify-mfa` | Verify OTP |
| POST | `/api/v1/auth/dev-login` | Skip OTP (debug mode) |
| POST | `/api/v1/auth/refresh` | Refresh JWT |

#### Others

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/v1/crm/module-settings` | Module enable/disable |
| GET/POST | `/api/v1/notifications` | In-app notifications |
| GET/POST | `/api/v1/notification-preferences` | Notification prefs |
| GET/PUT | `/api/v1/dashboard/layout` | Dashboard widget layout |

### 3.4 Custom Field Engine (EAV)

Two tables for tenant-specific custom fields:

```sql
custom_field_definitions
  id, tenant_id, module_name, field_key, field_label,
  field_type (text/number/boolean/date/select/multi_select/file),
  is_required, options_json, display_order, section, is_searchable,
  default_value, description

custom_field_values
  id, tenant_id, definition_id, record_id, module_name,
  value_text, value_number, value_boolean, value_date, value_json
  UNIQUE(definition_id, record_id)
```

PG helper function `get_custom_fields(tenant_id, module, record_ids[])` for batch loading.

### 3.5 Audit Log

`nexus_crm.activity_log` — every write action (create/update/delete) records:
- `actor_id`, `action`, `entity_type`, `entity_id`
- `summary` (human-readable: "Created task 'Buy groceries'")
- `changes` (JSON: {field: value} for updates)

---

## 4. Frontend Architecture

### 4.1 Design System

**Custom CSS variables** (in `src/index.css`):
```css
--color-primary, --color-primary-hover, --color-primary-light
--color-bg, --color-bg-card, --color-bg-page, --color-surface
--color-text, --color-text-secondary, --color-text-muted, --color-text-faint
--color-border, --color-divider
--color-success, --color-warning, --color-danger, --color-info
--color-notification, --color-notification-highlight
--topbar-h: 56px, --sidebar-w: 246px
--shadow-sm, --shadow-md, --shadow-lg
--radius-sm, --radius-md, --radius-lg
```

**Dark mode**: `data-theme="dark"` on `<html>`, toggled via Header. Persisted to `localStorage('nexus-theme')`.

**Two dashboard designs coexist:**
1. **Legacy DashboardPreview** — inside `<Layout />`, uses shared sidebar
2. **DashboardNew (design01)** — standalone shell (`position:fixed`), own sidebar + topbar, 37 widgets, 12-column CSS grid, drag-reorder, resize, widget picker drawer

### 4.2 Module System

Each entity (contacts/companies/tasks/touchpoints/projects) has:
- `config.ts` — Column definitions, field definitions, filter options, priority/status value mappings
- GenericListPage.tsx — Reusable list with search/filter/sort/pagination/column config
- GenericDetailPage.tsx — Reusable detail with tabs/edit/delete
- FieldsRenderer.tsx — Field rendering with floating labels

Module gating via:
- `SalesGate.tsx` / `ProjectGate.tsx` — Route-level guards
- `Sidebar.tsx` — Hides nav items based on module settings

### 4.3 Mobile Responsiveness

- Sidebar: slide-in drawer (hamburger → scrim → close on nav)
- Below 1024px: detail profile card stacks above content
- Below 768px: right panel drops below form  
- Below 480px: 2-col forms → 1-col
- iOS: `visualViewport` API for keyboard tracking, `-webkit-overflow-scrolling: touch`

---

## 5. Database Overview

**79 tables** across 2 schemas:

### nexus_auth (4 tables)
- `nexus_auth_tenants` — Multi-tenant root
- `nexus_auth_users` — User accounts
- `nexus_auth_tenant_members` — User↔Tenant membership
- `nexus_auth_sessions` — JWT session tracking

### nexus_crm (75 tables) — Key ones:

**Core CRM:** companies, contacts, touchpoints, tasks, notes, activity_log, files
**Sales:** deals, deal_stages, deal_pipelines, deal_line_items, deal_contacts, products, quotations, quotes
**Projects:** projects, project_stages, project_contacts, project_calendar_events, project_milestones, project_budgets
**Custom Fields:** custom_field_definitions, custom_field_values (EAV)
**Notifications:** notifications, notification_preferences
**HR/Org:** departments, teams, team_members, employees, roles, permissions
**Dispatch:** dispatch_queue, dispatch_assignments, dispatch_orders, dispatch_drivers, dispatch_vehicles, dispatch_zones
**Financial:** invoices, invoice_line_items, credit_holds, ar_aging_snapshots
**AI:** ai_enrichment_jobs, ai_forecasts, ai_meeting_briefs, ai_recommendations, ai_relationship_scores

**Full schema export available at:** `G08_SCHEMA.md` (same directory)

---

## 6. Key Design Patterns

### 6.1 EAV Custom Fields
Tenant-specific field definitions stored in `custom_field_definitions`. Values in `custom_field_values` with `UNIQUE(definition_id, record_id)`. Backend batch-loads via PG function `get_custom_fields()`. Frontend renders via FieldsRenderer.

### 6.2 Module Settings
`module_settings` table (tenant_id, module_key, enabled). Frontend `useModuleSettings` hook → Sidebar hides/shows nav items. SettingsPage toggles → dispatches `modules-changed` event.

### 6.3 Detail Drawer (SlideDrawer)
Right-side portal-based drawer (25vw desktop, 85vw mobile). Entity detail inside via DetailDrawerContent. Mobile: stacked sections (no tabs), all content visible vertically. Desktop: tab bar + switching. Four close mechanisms: handle tap + gap tap + X + Escape.

### 6.4 Calendar System
Custom Tailwind implementation (no react-big-calendar). Five views: Month/Week/Day/Deadline/Gantt. Weekend toggle (default off, persisted to localStorage). Project calendar uses `--color-*` CSS variables.

### 6.5 Dashboard 01 Widget Engine
37 widgets in a 12-column CSS grid. Widget registry (`allWidgets`) + order persistence (localStorage). Drag reorder (HTML5 DnD), add via drawer picker (9 module groups). Each widget has: head (icon + label + edit actions) + body (render function) + optional AI tag.

---

## 7. Current Development State

### Done ✅
- Full auth flow (register, login, MFA, JWT, refresh)
- Tenant isolation (RLS on 37 tables)
- Module A: Companies, Contacts, Touchpoints, Tasks, Notes, NameCards CRUD
- Module B: Deals, Pipelines, Stages, Products, Quotes CRUD
- Module C: Projects, Stages, Calendar Events CRUD
- Custom Field Engine (EAV, 40+ field defs seeded)
- Dashboard (37 widgets, drag-reorder, resize, drawer picker, mobile responsive)
- Module Settings system (enable/disable per tenant)
- Notification system (in-app bell + dropdown + page)
- Custom Calendar (Month/Week/Day/Deadline/Gantt)
- Activity Log (audit trail for all write actions)
- EAV custom fields in Task API (area, recurring, notion_priority, etc.)
- Notion → CRM data migration (100 companies, 199 contacts, 54 projects, 125 tasks)
- Architecture doc (10 immutable rules for personal + team workspace)

### In Progress 🔄
- Dashboard widget data enrichment (replacing demo data with real API data)
- Permission-Aware AI Module planning (new spec)

### Not Started ❌
- Workspace isolation (workspace_id on all records)
- Team collaboration (team CRUD, shared workspace)
- AI Chatbox integration with permission scope
- AI Tool Calling (whitelist-based, draft→confirm→execute)
- Vector/RAG search with metadata filtering
- Quota/subscription (usage tracking, model profiles)
- SSO/SCIM (enterprise)
- Multi-factor beyond OTP
- Shipment/Logistics module (dispatch tables exist but no frontend)
- Financial module (invoices, credit control)

---

## 8. Development Commands

```bash
# Backend (port 8001)
cd /home/airoot/projects/nexus-crm-saas/backend
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# Frontend (port 5173 for dev, 5174 for prod tunnel)
cd /home/airoot/projects/nexus-crm-saas
npx vite --port 5173 --host

# Build
npm run build

# Git (master branch, separate from GGDev repo)
git add . && git commit -m "..." && git push origin master
```

---

## 9. Integration Points

- **Cloudflared tunnel:** `nexus-crm.kinet-poc.com → localhost:5174`
- **PostgreSQL:** `gg_fighter` on `127.0.0.1:5432`, standby `nexus_app` on `:6432`
- **Redis:** `127.0.0.1:6379` (MFA rate limiting)
- **Email:** SMTP via configured provider (password reset, MFA)
- **Notion API:** Integration token for data import (one-time migration)

---

## 10. Known Design Decisions

1. **No CSS modules** — Flat global namespace in `index.css`. All classes are globally visible. Prefix convention: `stg-` for settings, `dash-` for dashboard.
2. **No Alembic** — `Base.metadata.create_all()` on startup. New columns added via manual ALTER TABLE.
3. **No formal testing** — No unit/integration test suite. Manual verification via build + browser refresh.
4. **No TypeScript strict mode** — Many `any`, `@ts-ignore`, and unused import warnings blocked from build by `// @ts-ignore` or commented out.
5. **Flat routing** — All routes flat in `App.tsx`. DashboardNew is standalone outside `<Layout />`.
6. **EAV for custom fields** — Chosen over JSONB column for field-level locking (collaboration use case).
7. **Minimal dependencies** — React + lucide-react only. No Formik, no React Query, no state management library.

---

*Export date: 2026-07-29*
*For Permission-Aware AI CRM Module planning by external AI design team.*
