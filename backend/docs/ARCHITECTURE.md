# NEXUS CRM Architecture — Personal + Team Workspace Model

Confirmed 2026-07-28 by Terrence. **NEVER violate these rules.**

## Core Identity

SaaS for sales professionals. Each user registers as an individual. Users can optionally join ONE team for shared collaboration.

## The 10 Immutable Rules

1. **Each user registers as an individual** → auto-creates personal tenant (one per signup)
2. **Max 1 team per user** → `nexus_auth_users.team_id` (nullable, 0 or 1). A user can be in at most one team at any time
3. **Each team = its own workspace** → team gets its own `tenant_id`. All team data lives under this tenant_id
4. **Workspace isolation** → Personal workspace and Team workspace each have fully independent:
   - contacts, companies, projects, tasks, touchpoints
   - custom_field_definitions (completely separate field sets)
   - deals, pipelines, products
5. **PERSONAL → TEAM: NO COPY** → Personal data must NEVER be copied or pushed into the team workspace. Zero exceptions.
6. **TEAM → PERSONAL: NO COPY** → Team data must NEVER be pulled or copied into a personal workspace. Zero exceptions.
7. **Authorized collaboration** → Users with proper role in a team (admin/editor) can collaboratively edit team workspace records
8. **Two contexts per user** → Every API client has exactly two possible tenant_ids:
   - `personal_tenant_id` (default, auto-created on registration)
   - `team_tenant_id` (set when user has `team_id`, derived via `team_id → team.tenant_id`)
9. **Tenant_id isolation for RLS** → The existing RLS pattern (`tenant_id = current_setting('app.tenant_id')`) works unchanged. The frontend/API layer just switches which tenant_id context is active per request
10. **Custom fields are per-workspace** → A field called `deal_source` in Personal workspace and a field called `deal_source` in Team workspace are different definitions in different tenant_ids. They don't clash and don't need to match

## User Table Schema

```sql
nexus_auth_users
  id                      UUID PRIMARY KEY
  email                   TEXT UNIQUE NOT NULL
  name                    TEXT NOT NULL
  personal_tenant_id      UUID NOT NULL REFERENCES nexus_auth_tenants(id)
  team_id                 UUID REFERENCES nexus_crm.teams(id)  -- NULLABLE, max 1
  created_at              TIMESTAMPTZ
```

## Team Table Schema

```sql
nexus_crm.teams
  id                      UUID PRIMARY KEY
  name                    TEXT NOT NULL
  tenant_id               UUID NOT NULL REFERENCES nexus_auth_tenants(id)
  owner_user_id           UUID NOT NULL REFERENCES nexus_auth_users(id)
  max_members             INTEGER DEFAULT 100
  created_at              TIMESTAMPTZ

nexus_crm.team_members
  team_id                 UUID REFERENCES nexus_crm.teams(id)
  user_id                 UUID REFERENCES nexus_auth_users(id)
  role                    TEXT NOT NULL  -- admin / editor / viewer
  joined_at               TIMESTAMPTZ
```

## Context Switching (API Layer)

```python
# On login/register, user gets JWT with both contexts
token_payload = {
    "sub": user.id,
    "personal_tenant": user.personal_tenant_id,
    "team_tenant": team.tenant_id if user.team_id else None,
}

# Each API request includes an X-Context header: "personal" | "team"
# Middleware resolves:
if request.headers.get("X-Context") == "team" and token["team_tenant"]:
    request.state.tenant_id = token["team_tenant"]
else:
    request.state.tenant_id = token["personal_tenant"]
```

## Permission Model (Per Workspace)

| Role | Personal | Team |
|------|----------|------|
| Member (single user) | Full access (admin) | N/A |
| Admin | — | Manage members, edit definitions, full CRUD |
| Editor | — | Create/edit/delete records |
| Viewer | — | Read only |

## What This Enables

- **5000 users × personal workspaces** → 5000 tenant_ids, fully isolated
- **Teams of 100+ people** → single tenant_id for the team, shared data + collaboration
- **Custom fields per workspace** → each personal and each team has its own definitions
- **SaaS billing model** → personal = free tier, team = paid tier
- **User leaves team** → clear team_id, personal data untouched
- **No cross-contamination** — the tenant_id firewall prevents personal↔team data leaks
