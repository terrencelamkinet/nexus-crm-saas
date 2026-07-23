# NEXUS AI CRM — Full SQL, Modules, and Relationship Architecture (For AI Agent)

## Overview

This document is the consolidated implementation-grade Markdown specification for the NEXUS AI CRM platform. It merges the foundation SQL structure, the AI CRM expanded field definitions, and the Team + Shipping/Logistics module plan into one full version for an AI agent, backend engineer, or solution architect to start system implementation.

The platform is designed as a multi-tenant PostgreSQL architecture with a modular product model. Foundation tables are always-on, while non-core modules can be enabled or disabled per tenant through a module registry and tenant-level settings, without deleting historical data.

The implementation principle is that CRM backbone entities such as companies, contacts, activities, deals, projects, products, tasks, files, teams, and users remain the permanent relational core, while AI, workflow, and shipping modules extend that core through explicit foreign keys and linking tables.

## Design principles

- Foundation first: `tenants`, `users`, `roles`, `permissions`, `files`, `companies`, `contacts`, `activities`, `deals`, `projects`, `products`, and audit fields form the long-term relational backbone.
- Modules are additive: Team/Org, AI, Workflow Apps, Shipping/Logistics, Credit Control, and Smart Dispatch extend the backbone rather than replacing it.
- Module toggles hide features, not records: disabling a module removes UI/API availability for a tenant but preserves data for future reactivation.
- Use explicit foreign keys and linking tables for relations that need filtering, metadata, auditing, or future extensibility.
- Keep tenant isolation strict: every tenant-scoped business table carries `tenant_id`, except pure linking tables whose parents are already tenant-scoped.
- AI-generated outputs must remain explainable and auditable through timestamps, source context, and `generated_by_agent_id` or equivalent fields.

## Module boundaries

| Layer | Scope | Can disable? |
|---|---|---|
| Foundation Core | tenant, user, RBAC, company, contact, activity, deal, project, product, task, file | No |
| Team & Org | departments, teams, members, departmental targets, user targets, dispatch rules | Prefer always enabled / operational core |
| AI Layer | relationship scoring, enrichment, recommendations, forecasts, meeting briefs, stakeholder intelligence | Yes |
| Workflow Apps | tenant-configurable workflow apps and runs | Yes |
| Shipping / Logistics | rate quotation, shipment parties, shipment docs, credit control, smart dispatch | Yes |
| Custom Field Engine | field definitions and record-level values for modules | Yes, but generally recommended on |

## Module enable / disable model

The module system is driven by `module_registry` and `tenant_module_settings`. This design allows the product to expose or hide specific modules per tenant without changing table structure or dropping historical records.

Recommended behavior:
- Foundation Core: always enabled, cannot be turned off.
- Team & Org: should be treated as operational core, especially for shipping CRM and dispatch ownership.
- AI Layer: can be enabled only for tenants with AI plan access.
- Workflow Apps: can be enabled for advanced tenants needing configurable automation.
- Shipping modules: enable by tenant according to business model, for example freight/logistics tenants only.

### Registry tables

```sql
CREATE TABLE module_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key VARCHAR(100) UNIQUE NOT NULL,
  module_name VARCHAR(255) NOT NULL,
  module_group VARCHAR(50),
  description TEXT,
  depends_on_module_key VARCHAR(100) REFERENCES module_registry(module_key),
  is_core BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tenant_module_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key VARCHAR(100) NOT NULL REFERENCES module_registry(module_key),
  is_enabled BOOLEAN DEFAULT true,
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id),
  UNIQUE (tenant_id, module_key)
);
```

### Suggested seed values

```sql
INSERT INTO module_registry (module_key, module_name, module_group, is_core) VALUES
('foundation.core', 'Foundation Core', 'core', true),
('team.org', 'Team Organization', 'core', true),
('ai.layer', 'AI Layer', 'ai', false),
('workflow.apps', 'Workflow Apps', 'ai', false),
('shipping.ratequotation', 'Rate Quotation', 'shipping', false),
('shipping.parties', 'Shipment Parties', 'shipping', false),
('shipping.creditcontrol', 'Credit Control', 'shipping', false),
('shipping.smartdispatch', 'Smart Dispatch', 'shipping', false);
```

## Foundation core schema

### Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Tenants, users, RBAC, files

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(150) UNIQUE,
  plan_key VARCHAR(50),
  status VARCHAR(30) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT,
  full_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  phone VARCHAR(50),
  avatar_file_id UUID,
  locale VARCHAR(20) DEFAULT 'zh-HK',
  timezone VARCHAR(50) DEFAULT 'Asia/Hong_Kong',
  status VARCHAR(30) DEFAULT 'ACTIVE',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role_key VARCHAR(100) NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, role_key)
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key VARCHAR(150) UNIQUE NOT NULL,
  permission_name VARCHAR(255) NOT NULL,
  module_key VARCHAR(100)
);

CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_filename VARCHAR(255),
  mime_type VARCHAR(100),
  file_size BIGINT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users
  ADD CONSTRAINT fk_users_avatar_file
  FOREIGN KEY (avatar_file_id) REFERENCES files(id);
```

## Team & organization module

```sql
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_department_id UUID REFERENCES departments(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id),
  name VARCHAR(255) NOT NULL,
  team_type VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_in_team VARCHAR(50) DEFAULT 'MEMBER',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE user_department_assignments (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT true,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE department_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  period_start DATE,
  period_end DATE,
  target_metric VARCHAR(50),
  target_value NUMERIC(18,2),
  actual_value NUMERIC(18,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE,
  period_end DATE,
  target_metric VARCHAR(50),
  target_value NUMERIC(18,2),
  actual_value NUMERIC(18,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dispatch_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id),
  rule_name VARCHAR(255),
  criteria_json JSONB,
  priority_order INT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## CRM business backbone

### Companies

```sql
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50),
  ceo_name VARCHAR(255),
  website VARCHAR(255),
  linkedin_url VARCHAR(255),
  logo_file_id UUID REFERENCES files(id),
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  city VARCHAR(100),
  state_region VARCHAR(100),
  postal_code VARCHAR(30),
  primary_contact_id UUID,
  owner_user_id UUID REFERENCES users(id),
  relationship_health_score NUMERIC(5,2),
  last_touchpoint_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE company_industries (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  industry_name VARCHAR(100),
  PRIMARY KEY (company_id, industry_name)
);

CREATE TABLE company_countries (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  country_code VARCHAR(10),
  PRIMARY KEY (company_id, country_code)
);
```

### Products

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  cost_price NUMERIC(18,2),
  selling_price NUMERIC(18,2),
  status VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Contacts

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  full_name VARCHAR(255) NOT NULL,
  chinese_name VARCHAR(255),
  nick_name VARCHAR(120),
  job_title VARCHAR(255),
  department_name VARCHAR(255),
  contact_type VARCHAR(50),
  contact_tag VARCHAR(50),
  contact_grade SMALLINT,
  email VARCHAR(255),
  mobile VARCHAR(50),
  office_phone VARCHAR(50),
  linkedin_url VARCHAR(255),
  address_text TEXT,
  notes_text TEXT,
  name_card_file_id UUID REFERENCES files(id),
  influence_score NUMERIC(5,2),
  relationship_health_score NUMERIC(5,2),
  owner_user_id UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'PROSPECT',
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE companies
  ADD CONSTRAINT fk_companies_primary_contact
  FOREIGN KEY (primary_contact_id) REFERENCES contacts(id);

CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_companies_tenant ON companies(tenant_id);
```

### Company-product and partner linking

```sql
CREATE TABLE company_products_in_use (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  since_date DATE,
  PRIMARY KEY (company_id, product_id)
);

CREATE TABLE company_product_proposals (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  proposed_at TIMESTAMPTZ,
  PRIMARY KEY (company_id, product_id)
);

CREATE TABLE company_partners (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  partner_company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  relation_type VARCHAR(50),
  PRIMARY KEY (company_id, partner_company_id, relation_type)
);
```

### Activities / touch points

```sql
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  reference_title VARCHAR(255),
  activity_time TIMESTAMPTZ NOT NULL,
  summary TEXT,
  content TEXT,
  ai_summary TEXT,
  sentiment_score NUMERIC(5,2),
  owner_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE activity_contacts (
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, contact_id)
);

CREATE TABLE activity_companies (
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, company_id)
);
```

### Deals / sales pipeline

```sql
CREATE TABLE deal_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deal_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES deal_pipelines(id) ON DELETE CASCADE,
  stage_key VARCHAR(100) NOT NULL,
  stage_name VARCHAR(255) NOT NULL,
  stage_order INT NOT NULL,
  probability_default NUMERIC(5,2),
  is_closed_won BOOLEAN DEFAULT false,
  is_closed_lost BOOLEAN DEFAULT false
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id UUID REFERENCES deal_pipelines(id),
  stage_id UUID REFERENCES deal_stages(id),
  name VARCHAR(255) NOT NULL,
  company_id UUID REFERENCES companies(id),
  primary_contact_id UUID REFERENCES contacts(id),
  amount NUMERIC(18,2),
  cost_amount NUMERIC(18,2),
  margin_amount NUMERIC(18,2),
  probability NUMERIC(5,2),
  expected_close_date DATE,
  owner_user_id UUID REFERENCES users(id),
  loss_reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deal_contacts (
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  role_type VARCHAR(50),
  PRIMARY KEY (deal_id, contact_id)
);
```

### Projects / delivery

```sql
CREATE TABLE project_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stage_key VARCHAR(100) NOT NULL,
  stage_name VARCHAR(255) NOT NULL,
  stage_order INT NOT NULL
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_code VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  company_id UUID REFERENCES companies(id) NOT NULL,
  originating_deal_id UUID REFERENCES deals(id),
  stage_id UUID REFERENCES project_stages(id),
  stage_updated_at TIMESTAMPTZ,
  status VARCHAR(50),
  priority VARCHAR(20),
  description TEXT,
  budget_amount NUMERIC(18,2),
  start_date DATE,
  deadline DATE,
  end_date DATE,
  project_manager_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE project_contacts (
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  relation_role VARCHAR(50),
  PRIMARY KEY (project_id, contact_id)
);

CREATE TABLE project_products (
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  relation_type VARCHAR(50),
  PRIMARY KEY (project_id, product_id)
);
```

### Tasks

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  deal_id UUID REFERENCES deals(id),
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(30) DEFAULT 'OPEN',
  priority VARCHAR(20),
  due_at TIMESTAMPTZ,
  assignee_user_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## AI layer

### Stakeholder intelligence

```sql
CREATE TABLE stakeholder_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  deal_id UUID REFERENCES deals(id),
  generated_by_agent_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE stakeholder_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID REFERENCES stakeholder_maps(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  reports_to_contact_id UUID REFERENCES contacts(id),
  influence_level VARCHAR(20),
  decision_role VARCHAR(50),
  sentiment VARCHAR(20)
);
```

### Relationship health, enrichment, meeting briefs

```sql
CREATE TABLE ai_relationship_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL,
  target_id UUID NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  trend VARCHAR(20),
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type VARCHAR(20) NOT NULL,
  target_id UUID NOT NULL,
  source_channel VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING',
  enriched_fields_json JSONB,
  run_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_meeting_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id),
  contact_id UUID REFERENCES contacts(id),
  company_id UUID REFERENCES companies(id),
  brief_text TEXT,
  generated_at TIMESTAMPTZ DEFAULT now()
);
```

### Recommendations and forecasts

```sql
CREATE TABLE ai_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_module VARCHAR(50) NOT NULL,
  target_record_id UUID NOT NULL,
  recommendation_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  rationale TEXT,
  confidence_score NUMERIC(5,2),
  priority_score NUMERIC(5,2),
  status VARCHAR(50) DEFAULT 'OPEN',
  generated_by_agent_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  acted_at TIMESTAMPTZ,
  acted_by UUID REFERENCES users(id)
);

CREATE TABLE ai_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  forecast_scope VARCHAR(50) NOT NULL,
  scope_record_id UUID,
  forecast_type VARCHAR(100) NOT NULL,
  forecast_period_start DATE,
  forecast_period_end DATE,
  forecast_value NUMERIC(18,2),
  confidence_low NUMERIC(18,2),
  confidence_high NUMERIC(18,2),
  explanation TEXT,
  generated_by_agent_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Workflow app builder

```sql
CREATE TABLE workflow_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  target_module VARCHAR(50),
  created_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workflow_app_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES workflow_apps(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  step_type VARCHAR(50) NOT NULL,
  config_json JSONB,
  agent_id UUID REFERENCES users(id)
);

CREATE TABLE workflow_app_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES workflow_apps(id),
  triggered_by UUID REFERENCES users(id),
  input_data JSONB,
  output_data JSONB,
  status VARCHAR(20) DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

## Custom field engine

```sql
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_name VARCHAR(50) NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  field_label VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  is_required BOOLEAN DEFAULT false,
  options_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, module_name, field_key)
);

CREATE TABLE custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id UUID REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  record_id UUID NOT NULL,
  value_text TEXT,
  value_number NUMERIC(18,4),
  value_boolean BOOLEAN,
  value_date DATE,
  value_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Shipping / logistics modules

### Rate quotation

```sql
CREATE TABLE trade_lanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  origin_port VARCHAR(100),
  destination_port VARCHAR(100),
  transport_mode VARCHAR(20),
  base_rate NUMERIC(18,2),
  currency VARCHAR(10),
  valid_from DATE,
  valid_to DATE
);

CREATE TABLE rate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  trade_lane_id UUID REFERENCES trade_lanes(id),
  cargo_description TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(50) DEFAULT 'OPEN',
  owner_user_id UUID REFERENCES users(id)
);

CREATE TABLE quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rate_request_id UUID REFERENCES rate_requests(id),
  deal_id UUID REFERENCES deals(id),
  quote_number VARCHAR(100),
  total_amount NUMERIC(18,2),
  currency VARCHAR(10),
  status VARCHAR(50) DEFAULT 'DRAFT',
  valid_until DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE quotation_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID REFERENCES quotations(id) ON DELETE CASCADE,
  charge_type VARCHAR(100),
  description TEXT,
  unit_price NUMERIC(18,2),
  quantity NUMERIC(18,2),
  amount NUMERIC(18,2)
);
```

### Shipments and shipment parties

```sql
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id),
  quotation_id UUID REFERENCES quotations(id),
  shipment_number VARCHAR(100),
  transport_mode VARCHAR(20),
  origin_port VARCHAR(100),
  destination_port VARCHAR(100),
  etd DATE,
  eta DATE,
  status VARCHAR(50) DEFAULT 'BOOKED',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE shipment_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  party_role VARCHAR(30) NOT NULL,
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  notes TEXT
);

CREATE TABLE shipment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  document_type VARCHAR(50),
  file_id UUID REFERENCES files(id),
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT now()
);
```

### Credit control

```sql
CREATE TABLE credit_control_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  credit_limit NUMERIC(18,2),
  overdue_days_threshold INT DEFAULT 30,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE ar_aging_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  snapshot_date DATE,
  current_amount NUMERIC(18,2),
  overdue_30 NUMERIC(18,2),
  overdue_60 NUMERIC(18,2),
  overdue_90_plus NUMERIC(18,2)
);

CREATE TABLE credit_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  shipment_id UUID REFERENCES shipments(id),
  reason TEXT,
  held_at TIMESTAMPTZ DEFAULT now(),
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id)
);
```

### Smart dispatch

```sql
CREATE TABLE dispatch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  contact_id UUID REFERENCES contacts(id),
  source_channel VARCHAR(50),
  status VARCHAR(50) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dispatch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES dispatch_queue(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id),
  assigned_by_rule_id UUID REFERENCES dispatch_rules(id),
  score NUMERIC(5,2),
  assigned_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dispatch_scoring_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES dispatch_queue(id) ON DELETE CASCADE,
  candidate_user_id UUID REFERENCES users(id),
  score NUMERIC(5,2),
  score_factors_json JSONB,
  computed_at TIMESTAMPTZ DEFAULT now()
);
```

## Relationship map across modules

| Source table | Linked table | Relationship purpose |
|---|---|---|
| `companies` | `contacts` | account-to-contact ownership |
| `activities` | `contacts`, `companies` | touch points and engagement memory |
| `deals` | `companies`, `contacts` | sales opportunity ownership |
| `projects` | `deals`, `companies`, `contacts` | bridge between sales and delivery |
| `shipments` | `projects`, `quotations` | bridge between delivery and shipping execution |
| `shipment_parties` | `companies`, `contacts` | shipper / consignee / notify / agent roles |
| `dispatch_assignments` | `dispatch_rules`, `users`, `teams` | operational routing ownership |
| `ai_recommendations` | any module record | explainable next-best-action |
| `ai_forecasts` | deals / projects / shipments | predictive intelligence |
| `stakeholder_relations` | `contacts` | influence map and decision-path visibility |
| `workflow_app_runs` | any module flow | tenant-specific automation runtime |

## AI agent implementation order

1. Create PostgreSQL extensions and Foundation Core tables first.
2. Create Team & Org tables because ownership, targets, and dispatch routing depend on them.
3. Create CRM backbone tables: companies, contacts, activities, deals, projects, products, tasks.
4. Create linking tables for company-product, project-contact, deal-contact, and activity associations.
5. Create the custom field engine.
6. Create AI layer tables.
7. Create workflow app builder tables.
8. Create Shipping / Logistics tables.
9. Seed the module registry and tenant defaults.
10. Add indexes, reporting views, and materialized views after real usage patterns appear.

## Implementation notes for AI agent

- Do not make Foundation Core optional.
- Enforce tenant boundaries consistently in API, ORM, and query layers.
- Where module dependencies exist, validate them at service level using `module_registry.depends_on_module_key` and tenant settings.
- Prefer linking tables instead of arrays when future metadata, filtering, or auditability may be required.
- Preserve explainability for AI output with rationale, confidence, actor, and timestamps.
- Treat shipping as a module family built on the same CRM data graph, not as a disconnected system.
- Treat teams and departments as first-class operational entities because dispatching, ownership, targets, and routing all depend on them.
