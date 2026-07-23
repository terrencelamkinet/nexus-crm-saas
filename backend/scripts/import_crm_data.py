#!/usr/bin/env python3
"""
Import CRM data from Notion export into Kinetix tenant.

Uses direct psycopg2 (sync) to bypass API schema limitations.
"""
import uuid
import json
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone

# Register UUID adapter so psycopg2 handles UUID objects natively
psycopg2.extras.register_uuid()

# ── Config ──────────────────────────────────────────────
TENANT_ID = "00000000-0000-0000-0000-000000000001"
KINETIX_COMPANY_ID = "2bc2b684-3a9e-4fc3-ab5d-f077cebf830d"
DB_URL = "postgresql://gg_fighter:F5xbTAzODUVEU4KDDIP@127.0.0.1:5432/nexus_crm"

conn = psycopg2.connect(DB_URL)
conn.autocommit = False
cur = conn.cursor()

def set_tenant():
    cur.execute(
        "SELECT set_config('app.tenant_id', %s, false)",
        (TENANT_ID,)
    )

def log(msg):
    print(f"  ✓ {msg}")

# ── Helpers ─────────────────────────────────────────────
def insert_company(name, domain, industry, size, phone, address, website, notes,
                   tags=None, custom_fields=None):
    cid = str(uuid.uuid4())
    tags_val = "{" + ",".join(tags or []) + "}"  # PostgreSQL ARRAY literal
    cf_val = json.dumps(custom_fields or {})
    set_tenant()
    cur.execute("""
        INSERT INTO nexus_crm.companies
            (id, tenant_id, name, domain, industry, size, phone, address, website, notes, tags, custom_fields,
             created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, %s::text[], %s::jsonb, %s, %s)
    """, (
        cid, TENANT_ID, name, domain, industry, size, phone, address, website, notes,
        tags_val, cf_val,
        datetime.now(timezone.utc), datetime.now(timezone.utc)
    ))
    return cid

def insert_industry(company_id, industry_name):
    try:
        cur.execute("""
            INSERT INTO nexus_crm.company_industries (company_id, industry_name)
            VALUES (%s::uuid, %s)
            ON CONFLICT DO NOTHING
        """, (company_id, industry_name))
    except Exception:
        pass  # skip if table doesn't exist or constraint issue

def insert_country(company_id, country_code):
    try:
        cur.execute("""
            INSERT INTO nexus_crm.company_countries (company_id, country_code)
            VALUES (%s::uuid, %s)
            ON CONFLICT DO NOTHING
        """, (company_id, country_code))
    except Exception:
        pass

def insert_contact(name, email, job_title, company_id, phone=None):
    cid = str(uuid.uuid4())
    set_tenant()
    cur.execute("""
        INSERT INTO nexus_crm.contacts
            (id, tenant_id, company_id, name, email, job_title, phone, status,
             created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s, %s)
    """, (
        cid, TENANT_ID, company_id, name, email, job_title, phone, "lead",
        datetime.now(timezone.utc), datetime.now(timezone.utc)
    ))
    return cid

def create_pipeline_if_needed():
    set_tenant()
    cur.execute("""
        SELECT id FROM nexus_crm.deal_pipelines
        WHERE tenant_id = %s::uuid AND is_default = true
    """, (TENANT_ID,))
    row = cur.fetchone()
    if row:
        log(f"Found existing default pipeline: {row[0]}")
        return row[0]

    pid = str(uuid.uuid4())
    set_tenant()
    cur.execute("""
        INSERT INTO nexus_crm.deal_pipelines
            (id, tenant_id, name, description, is_default, created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s)
    """, (
        pid, TENANT_ID, "Default Pipeline", "Default sales pipeline", True,
        datetime.now(timezone.utc), datetime.now(timezone.utc)
    ))
    log("Created Default Pipeline")

    # Create stages
    stages = [
        ("Quotation", 1, 10),
        ("Solution Presentation", 2, 30),
        ("In Progress", 3, 50),
        ("Pending", 4, 70),
        ("Closed Won", 5, 100),
    ]
    stage_ids = {}
    for name, order, prob in stages:
        sid = str(uuid.uuid4())
        set_tenant()
        cur.execute("""
            INSERT INTO nexus_crm.deal_stages
                (id, tenant_id, pipeline_id, name, probability, order_index, created_at, updated_at)
            VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s)
        """, (
            sid, TENANT_ID, pid, name, prob, order,
            datetime.now(timezone.utc), datetime.now(timezone.utc)
        ))
        stage_ids[name] = sid
        log(f"  Stage '{name}' created")

    return pid, stage_ids

def insert_deal(name, company_id, pipeline_id, stage_id, status, notes_text):
    did = str(uuid.uuid4())
    set_tenant()
    cur.execute("""
        INSERT INTO nexus_crm.deals
            (id, tenant_id, company_id, name, pipeline_id, stage_id, status, notes,
             created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s::uuid, %s::uuid, %s, %s, %s, %s)
    """, (
        did, TENANT_ID, company_id, name, pipeline_id, stage_id, status, notes_text,
        datetime.now(timezone.utc), datetime.now(timezone.utc)
    ))
    return did

def insert_touchpoint(type_, title, description, date_str, company_id=None):
    tid = str(uuid.uuid4())
    set_tenant()
    # Parse ISO date
    dt = datetime.fromisoformat(date_str)
    cur.execute("""
        INSERT INTO nexus_crm.touchpoints
            (id, tenant_id, type, title, description, date, company_id,
             created_at, updated_at)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid, %s, %s)
    """, (
        tid, TENANT_ID, type_, title, description, dt, company_id,
        datetime.now(timezone.utc), datetime.now(timezone.utc)
    ))
    return tid


# ══════════════════════════════════════════════════════════
# MAIN IMPORT
# ══════════════════════════════════════════════════════════

try:
    # ── Step 1: Companies ─────────────────────────────
    print("\n📦 Step 1: Importing Companies...")

    # 1. CPCE – Poly University
    cpce_id = insert_company(
        name="CPCE – Poly University",
        domain="cpce-polyu.edu.hk",
        industry="Education",
        size=None,
        phone=None,
        address="3/F, North Tower, PolyU West Kowloon Campus, 9 Hoi Ting Road, Yau Ma Tei, Kowloon",
        website="https://www.cpce-polyu.edu.hk/",
        notes="CEO: Prof. Peter P. Yuen (Dean)",
        tags=["Client"],
    )
    insert_industry(cpce_id, "Education")
    insert_country(cpce_id, "HK")
    log(f"CPCE – Poly University → {cpce_id}")

    # 2. Queens Mary Hospital
    qmh_id = insert_company(
        name="Queens Mary Hospital",
        domain=None,
        industry="Hospitality",
        size=None,
        phone=None,
        address="102 Pokfulam Road, Hong Kong",
        website="https://www8.ha.org.hk/qmh/",
        notes="CEO: Dr Theresa LI (Cluster Chief Executive, Hong Kong Island Cluster)",
        tags=["Client"],
    )
    insert_industry(qmh_id, "Hospitality")
    insert_country(qmh_id, "HK")
    log(f"Queens Mary Hospital → {qmh_id}")

    # 3. Haven of Hope Christian Service
    hoh_id = insert_company(
        name="Haven of Hope Christian Service",
        domain="hohcs.org.hk",
        industry=None,
        size=None,
        phone=None,
        address="7 Haven of Hope Road, Tseung Kwan O, New Territories, Hong Kong",
        website="http://www.hohcs.org.hk",
        notes="CEO: Dr. Lam Ching-choi",
        tags=["Client"],
    )
    insert_country(hoh_id, "HK")
    log(f"Haven of Hope Christian Service → {hoh_id}")

    # 4. HKMC Annuity Limited
    hkmc_id = insert_company(
        name="HKMC Annuity Limited",
        domain="hkmca.hk",
        industry="Services Provider",
        size=None,
        phone=None,
        address="19/F, Two Harbour Square, 180 Wai Yip Street, Kwun Tong, Kowloon, Hong Kong",
        website="https://www.hkmca.hk/eng/",
        notes="CEO: Daniel Leong Ling-chi; LinkedIn: https://www.linkedin.com/company/hkmc-annuity-limited/",
        tags=["Client"],
    )
    insert_industry(hkmc_id, "Services Provider")
    insert_country(hkmc_id, "HK")
    log(f"HKMC Annuity Limited → {hkmc_id}")

    # 5. 太興集團 (Tai Hing Group Holdings Limited)
    th_id = insert_company(
        name="太興集團 (Tai Hing Group Holdings Limited)",
        domain="taihing.com",
        industry="Manufactures",
        size=None,
        phone=None,
        address="13/F, Chinachem Exchange Square, 1 Hoi Wan Street, Quarry Bay, Hong Kong",
        website="https://www.taihing.com/",
        notes="CEO: Chan Wing On (陳永安); LinkedIn: https://hk.linkedin.com/company/tai-hing-group-holdings-limited",
        tags=["Client"],
    )
    insert_industry(th_id, "Manufactures")
    insert_country(th_id, "HK")
    log(f"太興集團 → {th_id}")

    conn.commit()
    print("  ✅ All companies committed.")

    # ── Step 2: Contacts ──────────────────────────────
    print("\n👤 Step 2: Importing Contacts...")

    contact_ids = {}
    c = insert_contact("Jackie Siu", "jackie.siu@cpce-polyu.edu.hk",
                        "Head of Marketing and Communication Office & Associate Head of IT", cpce_id)
    contact_ids["jackie_siu"] = c
    log(f"Jackie Siu → {c}")

    c = insert_contact("Arthur To", "arthurto@hkmca.hk",
                        "Senior Manager, Information Technology", hkmc_id)
    contact_ids["arthur_to"] = c
    log(f"Arthur To → {c}")

    c = insert_contact("Mourice Pang", "mouricepang@hkmca.hk",
                        "Head of Information Technology", hkmc_id)
    contact_ids["mourice_pang"] = c
    log(f"Mourice Pang → {c}")

    c = insert_contact("San Chung", "san.chung@taihing.com",
                        "Senior Deputy Director", th_id)
    contact_ids["san_chung"] = c
    log(f"San Chung → {c}")

    c = insert_contact("John Cheung", None,
                        "Assistant Head of IT", cpce_id)
    contact_ids["john_cheung"] = c
    log(f"John Cheung → {c}")

    conn.commit()
    print("  ✅ All contacts committed.")

    # ── Step 3: Pipeline & Stages ─────────────────────
    print("\n🔧 Step 3: Setting up Deal Pipeline...")
    pid, stage_ids = create_pipeline_if_needed()
    log(f"Pipeline ID: {pid}")
    conn.commit()
    print("  ✅ Pipeline and stages committed.")

    # ── Step 4: Deals (Projects) ──────────────────────
    print("\n💼 Step 4: Importing Deals (Projects)...")

    deal_map = {
        "in_progress": stage_ids["In Progress"],
        "pending": stage_ids["Pending"],
    }

    d1 = insert_deal(
        "CPCE - ManageEngine Endpoint Central",
        cpce_id, pid, stage_ids["In Progress"], "in_progress",
        "ManageEngine Endpoint Central (formerly Desktop Central) UEM deployment for CPCE PolyU. ~2,000 workstations across 3 campuses. Phase 1: 30x workstations pilot deployment."
    )
    log(f"CPCE - ManageEngine Endpoint Central → {d1}")

    d2 = insert_deal(
        "CPCE – SentinelOne Presentation Prep",
        cpce_id, pid, stage_ids["In Progress"], "in_progress",
        "Preparing for SentinelOne presentation at PolyU CPCE."
    )
    log(f"CPCE – SentinelOne Presentation Prep → {d2}")

    d3 = insert_deal(
        "Tai Hing – ITAM Discovery + OpenText ITAM Presentation",
        th_id, pid, stage_ids["Pending"], "pending",
        "ITAM discovery meeting + OpenText ITAM presentation. Capture requirements, pain points..."
    )
    log(f"Tai Hing – ITAM Discovery → {d3}")

    d4 = insert_deal(
        "HOHCS Hypervisor Upgrade",
        hoh_id, pid, stage_ids["In Progress"], "in_progress",
        "Hypervisor upgrade for Haven of Hope Christian Service."
    )
    log(f"HOHCS Hypervisor Upgrade → {d4}")

    d5 = insert_deal(
        "Sangfor – Virtualization Implementation",
        cpce_id, pid, stage_ids["Pending"], "pending",
        "Sangfor aSV Virtualization implementation for CPCE PolyU."
    )
    log(f"Sangfor – Virtualization Implementation → {d5}")

    conn.commit()
    print("  ✅ All deals committed.")

    # ── Step 5: Touchpoints ───────────────────────────
    print("\n📞 Step 5: Importing Touchpoints...")

    tp1 = insert_touchpoint(
        "meeting", "Discussion with Kinetix on HKMA AppScan Project",
        "Discussion about HKMA AppScan project",
        "2026-07-17T10:00:00+08:00",
        company_id=KINETIX_COMPANY_ID,
    )
    log(f"Touchpoint 1 → {tp1}")

    tp2 = insert_touchpoint(
        "meeting", "HCL AppScan POC Discussion w/ Kinetix",
        "POC discussion with HCLSoftware and Kinetix teams",
        "2026-07-16T14:00:00+08:00",
        company_id=KINETIX_COMPANY_ID,
    )
    log(f"Touchpoint 2 → {tp2}")

    tp3 = insert_touchpoint(
        "meeting", "Product Introduction w/ Kinetix Team",
        "Product introduction with digiDations and Wymax Technologies",
        "2026-07-15T11:00:00+08:00",
        company_id=KINETIX_COMPANY_ID,
    )
    log(f"Touchpoint 3 → {tp3}")

    tp4 = insert_touchpoint(
        "meeting", "Fubon Bank – API Gateway Quotation & Technical Proposal Discussion",
        "API Gateway quotation and technical proposal discussion",
        "2026-07-10T15:00:00+08:00",
    )
    log(f"Touchpoint 4 → {tp4}")

    tp5 = insert_touchpoint(
        "meeting", "Systex NetApp Briefing",
        "NetApp briefing with Systex team",
        "2026-07-08T10:00:00+08:00",
    )
    log(f"Touchpoint 5 → {tp5}")

    conn.commit()
    print("  ✅ All touchpoints committed.")

    # ── Summary ───────────────────────────────────────
    print("\n" + "=" * 60)
    print("📊 IMPORT SUMMARY")
    print("=" * 60)
    print(f"  Companies:    5 (CPCE, QMH, HOHCS, HKMC Annuity, Tai Hing)")
    print(f"  Contacts:     5 (Jackie Siu, Arthur To, Mourice Pang, San Chung, John Cheung)")
    print(f"  Pipeline:     1 (Default Pipeline with 5 stages)")
    print(f"  Deals:        5 (4 CPCE+1 Tai Hing+1 HOHCS)")
    print(f"  Touchpoints:  5 (3 linked to Kinetix HK)")
    print("=" * 60)

except Exception as e:
    conn.rollback()
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    raise

finally:
    cur.close()
    conn.close()
    print("\n✅ Database connection closed.")
