# NEXUS CRM (G08) — 完整 Schema Export

**Database:** PostgreSQL 16 on localhost
**Export Date:** 2026-07-28
**Purpose:** 俾 Permission-Aware AI CRM Module 開發用

---

## 背景

呢個係 G08 (NEXUS CRM) 現有 database schema，使用 `nexus_auth`（auth/tenant）同 `nexus_crm`（business data）兩個 schemas。
目標係喺呢個基礎上加 Permission-Aware AI Module，按 `permission-aware-ai-crm-spec` 規格開發。

## 對 Spec 嘅關鍵 Gap

| Spec 要求 | G08 現狀 | 要加嘅嘢 |
|-----------|----------|---------|
| `workspace_id` per record | ❌ 冇 | 所有 core tables 加 column |
| `team_id` per record | ❌ 冇 | 加 column |
| `visibility_scope` (private/team/workspace/tenant_admin) | ❌ 冇 | 加 column + enum |
| `owner_user_id` per record | ✅ 部分有 | 要加落未有的 table |
| `version` (optimistic locking) | ❌ 冇 | 全部 write table 加 |
| RLS on ALL core tables | ✅ 37/79 tables | 補齊未加的 |
| AI session context middleware | ❌ 冇 | 新 middleware |
| AI tool calling whitelist | ❌ 冇 | ~15 tools |
| ai_action_requests (draft→confirm) | ❌ 冇 | 新 table |
| Vector store + metadata filter | ❌ 冇 | pgvector |
| Quota/subscription | ❌ 冇 | ai_usage_* tables |
| Provider abstraction | ❌ 冇 | model_profiles table |
| Teams/Roles/Permissions | ✅ 有 `teams`, `roles`, `permissions`, `user_roles`, `team_members` | 要整合入 AI session |

## Core Tables（AI Module 要改嘅）

呢堆 table 係 AI Module 直接相關，需要加 `workspace_id`, `team_id`, `visibility_scope`, `version`：

- **companies** — Client companies (FK: tenant, owner)
- **contacts** — Contact persons (FK: tenant, company, owner)
- **projects** — Projects (FK: tenant, company, stage)
- **tasks** — Tasks (FK: tenant, contact, company, assignee)
- **touchpoints** — Interaction records (FK: tenant, contact, company)
- **notes** — Notes (FK: tenant, contact, company)
- **deals** — Deal pipeline (FK: tenant, company, stage)
- **activity_log** — Audit log (FK: tenant, actor)

---

## Schema Details

     1|## Schema: `nexus_auth` — Authentication & Tenant Management
     2|
     3|### nexus_auth_sessions
     4|
     5|| Column | Type | Nullable | Default |
     6||--------|------|----------|---------|
     7|| `id` | uuid | NO |  |
     8|| `user_id` | uuid | NO |  |
     9|| `refresh_token` | text | NO |  |
    10|| `user_agent` | text | YES |  |
    11|| `ip_address` | character varying(45) | YES |  |
    12|| `expires_at` | timestamp with time zone | NO |  |
    13|| `revoked` | boolean | YES |  |
    14|| `created_at` | timestamp with time zone | YES |  |
    15|
    16|- **PK:** PRIMARY KEY (id)
    17|- **FK:** `nexus_auth_sessions_user_id_fkey` → FOREIGN KEY (user_id) REFERENCES nexus_auth.nexus_auth_users(id) ON DELETE CASCADE
    18|- **UNIQUE:** `nexus_auth_sessions_refresh_token_key` → UNIQUE (refresh_token)
    19|
    20|- **Index:** `CREATE UNIQUE INDEX nexus_auth_sessions_refresh_token_key ON nexus_auth.nexus_auth_sessions USING btree (refresh_token)`
    21|
    22|---
    23|
    24|### nexus_auth_tenant_members
    25|
    26|| Column | Type | Nullable | Default |
    27||--------|------|----------|---------|
    28|| `id` | uuid | NO |  |
    29|| `tenant_id` | uuid | NO |  |
    30|| `user_id` | uuid | NO |  |
    31|| `role` | character varying(50) | YES |  |
    32|| `created_at` | timestamp with time zone | YES |  |
    33|
    34|- **PK:** PRIMARY KEY (id)
    35|- **FK:** `nexus_auth_tenant_members_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
    36|- **FK:** `nexus_auth_tenant_members_user_id_fkey` → FOREIGN KEY (user_id) REFERENCES nexus_auth.nexus_auth_users(id) ON DELETE CASCADE
    37|
    38|
    39|---
    40|
    41|### nexus_auth_tenants
    42|
    43|| Column | Type | Nullable | Default |
    44||--------|------|----------|---------|
    45|| `id` | uuid | NO |  |
    46|| `name` | character varying(255) | NO |  |
    47|| `subdomain` | character varying(255) | YES |  |
    48|| `settings` | json | YES |  |
    49|| `is_active` | boolean | YES |  |
    50|| `created_at` | timestamp with time zone | YES |  |
    51|| `updated_at` | timestamp with time zone | YES |  |
    52|
    53|- **PK:** PRIMARY KEY (id)
    54|- **UNIQUE:** `nexus_auth_tenants_subdomain_key` → UNIQUE (subdomain)
    55|
    56|- **Index:** `CREATE UNIQUE INDEX nexus_auth_tenants_subdomain_key ON nexus_auth.nexus_auth_tenants USING btree (subdomain)`
    57|
    58|---
    59|
    60|### nexus_auth_users
    61|
    62|| Column | Type | Nullable | Default |
    63||--------|------|----------|---------|
    64|| `id` | uuid | NO |  |
    65|| `email` | character varying(255) | NO |  |
    66|| `password_hash` | character varying(255) | NO |  |
    67|| `display_name` | character varying(255) | YES |  |
    68|| `email_verified` | boolean | YES |  |
    69|| `mfa_enabled` | boolean | YES |  |
    70|| `role` | character varying(50) | YES |  |
    71|| `created_at` | timestamp with time zone | YES |  |
    72|| `updated_at` | timestamp with time zone | YES |  |
    73|
    74|- **PK:** PRIMARY KEY (id)
    75|
    76|- **Index:** `CREATE UNIQUE INDEX ix_nexus_auth_nexus_auth_users_email ON nexus_auth.nexus_auth_users USING btree (email)`
    77|
    78|---
    79|
    80|## Schema: `nexus_crm` — Business CRM Data
    81|
    82|### activities
    83|
    84|| Column | Type | Nullable | Default |
    85||--------|------|----------|---------|
    86|| `id` | uuid | NO | gen_random_uuid() |
    87|| `tenant_id` | uuid | NO |  |
    88|| `activity_type` | character varying(50) | NO |  |
    89|| `reference_title` | character varying(255) | YES |  |
    90|| `activity_time` | timestamp with time zone | NO | now() |
    91|| `summary` | text | YES |  |
    92|| `content` | text | YES |  |
    93|| `ai_summary` | text | YES |  |
    94|| `sentiment_score` | numeric | YES |  |
    95|| `owner_user_id` | uuid | YES |  |
    96|| `created_at` | timestamp with time zone | YES | now() |
    97|| `updated_at` | timestamp with time zone | YES | now() |
    98|
    99|- **PK:** PRIMARY KEY (id)
   100|- **FK:** `activities_owner_user_id_fkey` → FOREIGN KEY (owner_user_id) REFERENCES nexus_auth.nexus_auth_users(id)
   101|- **FK:** `activities_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   102|
   103|- **Index:** `CREATE INDEX idx_activities_tenant ON nexus_crm.activities USING btree (tenant_id)`
   104|- **Index:** `CREATE INDEX idx_activities_time ON nexus_crm.activities USING btree (activity_time)`
   105|- 🔒 RLS Enabled
   106|
   107|---
   108|
   109|### activity_companies
   110|
   111|| Column | Type | Nullable | Default |
   112||--------|------|----------|---------|
   113|| `activity_id` | uuid | NO |  |
   114|| `company_id` | uuid | NO |  |
   115|
   116|- **PK:** PRIMARY KEY (activity_id, company_id)
   117|- **FK:** `activity_companies_activity_id_fkey` → FOREIGN KEY (activity_id) REFERENCES nexus_crm.activities(id) ON DELETE CASCADE
   118|- **FK:** `activity_companies_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   119|
   120|
   121|---
   122|
   123|### activity_contacts
   124|
   125|| Column | Type | Nullable | Default |
   126||--------|------|----------|---------|
   127|| `activity_id` | uuid | NO |  |
   128|| `contact_id` | uuid | NO |  |
   129|
   130|- **PK:** PRIMARY KEY (activity_id, contact_id)
   131|- **FK:** `activity_contacts_activity_id_fkey` → FOREIGN KEY (activity_id) REFERENCES nexus_crm.activities(id) ON DELETE CASCADE
   132|- **FK:** `activity_contacts_contact_id_fkey` → FOREIGN KEY (contact_id) REFERENCES nexus_crm.contacts(id) ON DELETE CASCADE
   133|
   134|
   135|---
   136|
   137|### activity_log
   138|
   139|| Column | Type | Nullable | Default |
   140||--------|------|----------|---------|
   141|| `id` | uuid | NO | gen_random_uuid() |
   142|| `tenant_id` | uuid | NO |  |
   143|| `actor_id` | uuid | YES |  |
   144|| `action` | text | NO |  |
   145|| `entity_type` | text | NO |  |
   146|| `entity_id` | uuid | YES |  |
   147|| `summary` | text | YES |  |
   148|| `changes` | jsonb | YES |  |
   149|| `created_at` | timestamp with time zone | YES | now() |
   150|
   151|- **PK:** PRIMARY KEY (id)
   152|- **FK:** `activity_log_actor_id_fkey` → FOREIGN KEY (actor_id) REFERENCES nexus_auth.nexus_auth_users(id) ON DELETE SET NULL
   153|- **FK:** `activity_log_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   154|
   155|- **Index:** `CREATE INDEX idx_activity_log_created ON nexus_crm.activity_log USING btree (created_at DESC)`
   156|- **Index:** `CREATE INDEX idx_activity_log_entity ON nexus_crm.activity_log USING btree (entity_type, entity_id)`
   157|- **Index:** `CREATE INDEX idx_activity_log_tenant ON nexus_crm.activity_log USING btree (tenant_id)`
   158|- 🔒 RLS Enabled
   159|
   160|---
   161|
   162|### ai_enrichment_jobs
   163|
   164|| Column | Type | Nullable | Default |
   165||--------|------|----------|---------|
   166|| `id` | uuid | NO | gen_random_uuid() |
   167|| `tenant_id` | uuid | NO |  |
   168|| `target_type` | character varying(20) | NO |  |
   169|| `target_id` | uuid | NO |  |
   170|| `source_channel` | character varying(50) | YES |  |
   171|| `status` | character varying(20) | YES | 'PENDING'::character varying |
   172|| `enriched_fields_json` | jsonb | YES |  |
   173|| `run_at` | timestamp with time zone | YES | now() |
   174|
   175|- **PK:** PRIMARY KEY (id)
   176|- **FK:** `ai_enrichment_jobs_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   177|
   178|- **Index:** `CREATE INDEX idx_ai_enrichment_jobs_status ON nexus_crm.ai_enrichment_jobs USING btree (status)`
   179|- **Index:** `CREATE INDEX idx_ai_enrichment_jobs_tenant ON nexus_crm.ai_enrichment_jobs USING btree (tenant_id)`
   180|- 🔒 RLS Enabled
   181|
   182|---
   183|
   184|### ai_forecasts
   185|
   186|| Column | Type | Nullable | Default |
   187||--------|------|----------|---------|
   188|| `id` | uuid | NO | gen_random_uuid() |
   189|| `tenant_id` | uuid | NO |  |
   190|| `forecast_scope` | character varying(50) | NO |  |
   191|| `scope_record_id` | uuid | YES |  |
   192|| `forecast_type` | character varying(100) | NO |  |
   193|| `forecast_period_start` | date | YES |  |
   194|| `forecast_period_end` | date | YES |  |
   195|| `forecast_value` | numeric | YES |  |
   196|| `confidence_low` | numeric | YES |  |
   197|| `confidence_high` | numeric | YES |  |
   198|| `explanation` | text | YES |  |
   199|| `generated_by_agent_id` | uuid | YES |  |
   200|| `created_at` | timestamp with time zone | YES | now() |
   201|
   202|- **PK:** PRIMARY KEY (id)
   203|- **FK:** `ai_forecasts_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   204|
   205|- 🔒 RLS Enabled
   206|
   207|---
   208|
   209|### ai_meeting_briefs
   210|
   211|| Column | Type | Nullable | Default |
   212||--------|------|----------|---------|
   213|| `id` | uuid | NO | gen_random_uuid() |
   214|| `tenant_id` | uuid | NO |  |
   215|| `activity_id` | uuid | YES |  |
   216|| `contact_id` | uuid | YES |  |
   217|| `company_id` | uuid | YES |  |
   218|| `brief_text` | text | YES |  |
   219|| `generated_at` | timestamp with time zone | YES | now() |
   220|
   221|- **PK:** PRIMARY KEY (id)
   222|- **FK:** `ai_meeting_briefs_activity_id_fkey` → FOREIGN KEY (activity_id) REFERENCES nexus_crm.activities(id)
   223|- **FK:** `ai_meeting_briefs_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id)
   224|- **FK:** `ai_meeting_briefs_contact_id_fkey` → FOREIGN KEY (contact_id) REFERENCES nexus_crm.contacts(id)
   225|- **FK:** `ai_meeting_briefs_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   226|
   227|- **Index:** `CREATE INDEX idx_ai_meeting_briefs_tenant ON nexus_crm.ai_meeting_briefs USING btree (tenant_id)`
   228|- 🔒 RLS Enabled
   229|
   230|---
   231|
   232|### ai_recommendations
   233|
   234|| Column | Type | Nullable | Default |
   235||--------|------|----------|---------|
   236|| `id` | uuid | NO | gen_random_uuid() |
   237|| `tenant_id` | uuid | NO |  |
   238|| `target_module` | character varying(50) | NO |  |
   239|| `target_record_id` | uuid | NO |  |
   240|| `recommendation_type` | character varying(100) | NO |  |
   241|| `title` | character varying(255) | NO |  |
   242|| `rationale` | text | YES |  |
   243|| `confidence_score` | numeric | YES |  |
   244|| `priority_score` | numeric | YES |  |
   245|| `status` | character varying(50) | YES | 'OPEN'::character varying |
   246|| `generated_by_agent_id` | uuid | YES |  |
   247|| `created_at` | timestamp with time zone | YES | now() |
   248|| `acted_at` | timestamp with time zone | YES |  |
   249|| `acted_by` | uuid | YES |  |
   250|
   251|- **PK:** PRIMARY KEY (id)
   252|- **FK:** `ai_recommendations_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   253|
   254|- **Index:** `CREATE INDEX idx_ai_recommendations_target ON nexus_crm.ai_recommendations USING btree (target_module, target_record_id)`
   255|- **Index:** `CREATE INDEX idx_ai_recommendations_tenant ON nexus_crm.ai_recommendations USING btree (tenant_id)`
   256|- 🔒 RLS Enabled
   257|
   258|---
   259|
   260|### ai_relationship_scores
   261|
   262|| Column | Type | Nullable | Default |
   263||--------|------|----------|---------|
   264|| `id` | uuid | NO | gen_random_uuid() |
   265|| `tenant_id` | uuid | NO |  |
   266|| `target_type` | character varying(20) | NO |  |
   267|| `target_id` | uuid | NO |  |
   268|| `score` | numeric | NO |  |
   269|| `trend` | character varying(20) | YES |  |
   270|| `computed_at` | timestamp with time zone | YES | now() |
   271|
   272|- **PK:** PRIMARY KEY (id)
   273|- **FK:** `ai_relationship_scores_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   274|
   275|- **Index:** `CREATE INDEX idx_ai_relationship_scores_target ON nexus_crm.ai_relationship_scores USING btree (target_type, target_id)`
   276|- **Index:** `CREATE INDEX idx_ai_relationship_scores_tenant ON nexus_crm.ai_relationship_scores USING btree (tenant_id)`
   277|- 🔒 RLS Enabled
   278|
   279|---
   280|
   281|### ar_aging_snapshots
   282|
   283|| Column | Type | Nullable | Default |
   284||--------|------|----------|---------|
   285|| `id` | uuid | NO | gen_random_uuid() |
   286|| `company_id` | uuid | YES |  |
   287|| `snapshot_date` | date | YES |  |
   288|| `current_amount` | numeric | YES |  |
   289|| `overdue_30` | numeric | YES |  |
   290|| `overdue_60` | numeric | YES |  |
   291|| `overdue_90_plus` | numeric | YES |  |
   292|
   293|- **PK:** PRIMARY KEY (id)
   294|- **FK:** `ar_aging_snapshots_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id)
   295|
   296|
   297|---
   298|
   299|### companies
   300|
   301|| Column | Type | Nullable | Default |
   302||--------|------|----------|---------|
   303|| `id` | uuid | NO | gen_random_uuid() |
   304|| `tenant_id` | uuid | NO |  |
   305|| `name` | text | NO |  |
   306|| `domain` | text | YES |  |
   307|| `industry` | text | YES |  |
   308|| `size` | text | YES |  |
   309|| `phone` | text | YES |  |
   310|| `address` | text | YES |  |
   311|| `website` | text | YES |  |
   312|| `notes` | text | YES |  |
   313|| `tags` | ARRAY | YES | '{}'::text[] |
   314|| `owner_id` | uuid | YES |  |
   315|| `custom_fields` | jsonb | YES | '{}'::jsonb |
   316|| `created_at` | timestamp with time zone | YES | now() |
   317|| `updated_at` | timestamp with time zone | YES | now() |
   318|| `category` | character varying(50) | YES |  |
   319|| `ceo_name` | character varying(255) | YES |  |
   320|| `linkedin_url` | character varying(255) | YES |  |
   321|| `logo_file_id` | uuid | YES |  |
   322|| `primary_contact_id` | uuid | YES |  |
   323|| `relationship_health_score` | numeric | YES |  |
   324|| `last_touchpoint_at` | timestamp with time zone | YES |  |
   325|| `status` | character varying(50) | YES | 'ACTIVE'::character varying |
   326|
   327|- **PK:** PRIMARY KEY (id)
   328|- **FK:** `companies_owner_id_fkey` → FOREIGN KEY (owner_id) REFERENCES nexus_auth.nexus_auth_users(id) ON DELETE SET NULL
   329|- **FK:** `companies_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   330|
   331|- **Index:** `CREATE INDEX idx_companies_name ON nexus_crm.companies USING btree (name)`
   332|- **Index:** `CREATE INDEX idx_companies_owner ON nexus_crm.companies USING btree (owner_id)`
   333|- **Index:** `CREATE INDEX idx_companies_tenant ON nexus_crm.companies USING btree (tenant_id)`
   334|- 🔒 RLS Enabled
   335|
   336|---
   337|
   338|### company_countries
   339|
   340|| Column | Type | Nullable | Default |
   341||--------|------|----------|---------|
   342|| `company_id` | uuid | NO |  |
   343|| `country_code` | character varying(10) | NO |  |
   344|
   345|- **PK:** PRIMARY KEY (company_id, country_code)
   346|- **FK:** `company_countries_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   347|
   348|
   349|---
   350|
   351|### company_industries
   352|
   353|| Column | Type | Nullable | Default |
   354||--------|------|----------|---------|
   355|| `company_id` | uuid | NO |  |
   356|| `industry_name` | character varying(100) | NO |  |
   357|
   358|- **PK:** PRIMARY KEY (company_id, industry_name)
   359|- **FK:** `company_industries_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   360|
   361|
   362|---
   363|
   364|### company_partners
   365|
   366|| Column | Type | Nullable | Default |
   367||--------|------|----------|---------|
   368|| `company_id` | uuid | NO |  |
   369|| `partner_company_id` | uuid | NO |  |
   370|| `relation_type` | character varying(50) | NO |  |
   371|
   372|- **PK:** PRIMARY KEY (company_id, partner_company_id, relation_type)
   373|- **FK:** `company_partners_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   374|- **FK:** `company_partners_partner_company_id_fkey` → FOREIGN KEY (partner_company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   375|
   376|
   377|---
   378|
   379|### company_product_proposals
   380|
   381|| Column | Type | Nullable | Default |
   382||--------|------|----------|---------|
   383|| `company_id` | uuid | NO |  |
   384|| `product_id` | uuid | NO |  |
   385|| `proposed_at` | timestamp with time zone | YES |  |
   386|
   387|- **PK:** PRIMARY KEY (company_id, product_id)
   388|- **FK:** `company_product_proposals_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   389|- **FK:** `company_product_proposals_product_id_fkey` → FOREIGN KEY (product_id) REFERENCES nexus_crm.products(id) ON DELETE CASCADE
   390|
   391|
   392|---
   393|
   394|### company_products_in_use
   395|
   396|| Column | Type | Nullable | Default |
   397||--------|------|----------|---------|
   398|| `company_id` | uuid | NO |  |
   399|| `product_id` | uuid | NO |  |
   400|| `since_date` | date | YES |  |
   401|
   402|- **PK:** PRIMARY KEY (company_id, product_id)
   403|- **FK:** `company_products_in_use_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE CASCADE
   404|- **FK:** `company_products_in_use_product_id_fkey` → FOREIGN KEY (product_id) REFERENCES nexus_crm.products(id) ON DELETE CASCADE
   405|
   406|
   407|---
   408|
   409|### contact_projects
   410|
   411|| Column | Type | Nullable | Default |
   412||--------|------|----------|---------|
   413|| `id` | uuid | NO | gen_random_uuid() |
   414|| `tenant_id` | uuid | NO |  |
   415|| `contact_id` | uuid | NO |  |
   416|| `project_id` | uuid | NO |  |
   417|| `role` | text | YES |  |
   418|| `created_at` | timestamp with time zone | YES | now() |
   419|
   420|- **PK:** PRIMARY KEY (id)
   421|- **FK:** `contact_projects_contact_id_fkey` → FOREIGN KEY (contact_id) REFERENCES nexus_crm.contacts(id) ON DELETE CASCADE
   422|- **FK:** `contact_projects_project_id_fkey` → FOREIGN KEY (project_id) REFERENCES nexus_crm.deals(id) ON DELETE CASCADE
   423|- **FK:** `contact_projects_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   424|- **UNIQUE:** `contact_projects_contact_id_project_id_key` → UNIQUE (contact_id, project_id)
   425|
   426|- **Index:** `CREATE UNIQUE INDEX contact_projects_contact_id_project_id_key ON nexus_crm.contact_projects USING btree (contact_id, project_id)`
   427|- **Index:** `CREATE INDEX idx_contact_projects_contact ON nexus_crm.contact_projects USING btree (contact_id)`
   428|- **Index:** `CREATE INDEX idx_contact_projects_project ON nexus_crm.contact_projects USING btree (project_id)`
   429|- **Index:** `CREATE INDEX idx_contact_projects_tenant ON nexus_crm.contact_projects USING btree (tenant_id)`
   430|- 🔒 RLS Enabled
   431|
   432|---
   433|
   434|### contacts
   435|
   436|| Column | Type | Nullable | Default |
   437||--------|------|----------|---------|
   438|| `id` | uuid | NO | gen_random_uuid() |
   439|| `tenant_id` | uuid | NO |  |
   440|| `company_id` | uuid | YES |  |
   441|| `name` | text | NO |  |
   442|| `email` | text | YES |  |
   443|| `phone` | text | YES |  |
   444|| `job_title` | text | YES |  |
   445|| `department` | text | YES |  |
   446|| `linkedin_url` | text | YES |  |
   447|| `avatar_url` | text | YES |  |
   448|| `address` | text | YES |  |
   449|| `notes` | text | YES |  |
   450|| `tags` | ARRAY | YES | '{}'::text[] |
   451|| `source` | text | YES |  |
   452|| `status` | text | YES | 'lead'::text |
   453|| `owner_id` | uuid | YES |  |
   454|| `custom_fields` | jsonb | YES | '{}'::jsonb |
   455|| `created_at` | timestamp with time zone | YES | now() |
   456|| `updated_at` | timestamp with time zone | YES | now() |
   457|| `chinese_name` | text | YES |  |
   458|| `nick_name` | text | YES |  |
   459|| `contact_type` | text | YES |  |
   460|| `grade` | text | YES |  |
   461|| `numbers` | ARRAY | YES | '{}'::text[] |
   462|| `office_phone` | text | YES |  |
   463|| `namecard_path` | text | YES |  |
   464|
   465|- **PK:** PRIMARY KEY (id)
   466|- **FK:** `contacts_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id) ON DELETE SET NULL
   467|- **FK:** `contacts_owner_id_fkey` → FOREIGN KEY (owner_id) REFERENCES nexus_auth.nexus_auth_users(id) ON DELETE SET NULL
   468|- **FK:** `contacts_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   469|
   470|- **Index:** `CREATE INDEX idx_contacts_chinese_name ON nexus_crm.contacts USING btree (chinese_name)`
   471|- **Index:** `CREATE INDEX idx_contacts_company ON nexus_crm.contacts USING btree (company_id)`
   472|- **Index:** `CREATE INDEX idx_contacts_contact_type ON nexus_crm.contacts USING btree (contact_type)`
   473|- **Index:** `CREATE INDEX idx_contacts_email ON nexus_crm.contacts USING btree (email)`
   474|- **Index:** `CREATE INDEX idx_contacts_grade ON nexus_crm.contacts USING btree (grade)`
   475|- **Index:** `CREATE INDEX idx_contacts_name ON nexus_crm.contacts USING btree (name)`
   476|- **Index:** `CREATE INDEX idx_contacts_owner ON nexus_crm.contacts USING btree (owner_id)`
   477|- **Index:** `CREATE INDEX idx_contacts_status ON nexus_crm.contacts USING btree (status)`
   478|- **Index:** `CREATE INDEX idx_contacts_tenant ON nexus_crm.contacts USING btree (tenant_id)`
   479|- 🔒 RLS Enabled
   480|
   481|---
   482|
   483|### credit_control_rules
   484|
   485|| Column | Type | Nullable | Default |
   486||--------|------|----------|---------|
   487|| `id` | uuid | NO | gen_random_uuid() |
   488|| `tenant_id` | uuid | NO |  |
   489|| `company_id` | uuid | YES |  |
   490|| `credit_limit` | numeric | YES |  |
   491|| `overdue_days_threshold` | integer | YES | 30 |
   492|| `is_active` | boolean | YES | true |
   493|
   494|- **PK:** PRIMARY KEY (id)
   495|- **FK:** `credit_control_rules_company_id_fkey` → FOREIGN KEY (company_id) REFERENCES nexus_crm.companies(id)
   496|- **FK:** `credit_control_rules_tenant_id_fkey` → FOREIGN KEY (tenant_id) REFERENCES nexus_auth.nexus_auth_tenants(id) ON DELETE CASCADE
   497|
   498|- **Index:** `CREATE INDEX idx_credit_control_rules_tenant ON nexus_crm.credit_control_rules USING btree (tenant_id)`
   499|- 🔒 RLS Enabled
   500|
   501|