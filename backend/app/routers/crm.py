"""
CRM Module A — FastAPI CRUD router.

Flat path structure under /api/v1/crm:
  GET    /{entity}          → list (paginated, filterable)
  POST   /{entity}          → create
  GET    /{entity}/{id}     → read
  PATCH  /{entity}/{id}     → partial update
  DELETE /{entity}/{id}     → delete (204)

Entity types: companies, contacts, touchpoints, tasks, name-cards, notes, activity-log, tags

Every write operation (create / update / delete) records an ActivityLog row.
"""

from uuid import UUID
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy import func, select, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import ColumnProperty, selectinload

from app.db import get_tenant_session
from app.models.crm import (
    ActivityLog,
    Company,
    Contact,
    ContactProject,
    NameCard,
    Note,
    Project,
    ProjectCalendarEvent,
    Tag,
    Task,
    Touchpoint,
    TouchpointParticipant,
)
from app.models.crm_module_b import Deal, DealStage
from app.services import namecard_agents, namecard_llm
from app.schemas.crm import (
    ActivityLogCreate,
    ActivityLogResponse,
    CompanyCreate,
    CompanyResponse,
    CompanyUpdate,
    ContactCreate,
    ContactProjectCreate,
    ContactProjectResponse,
    ContactResponse,
    ContactUpdate,
    ListResponse,
    NameCardCreate,
    NameCardResponse,
    NameCardResolveRequest,
    NameCardUpdate,
    NoteCreate,
    NoteResponse,
    NoteUpdate,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
    ProjectCalendarEventCreate,
    ProjectCalendarEventResponse,
    ProjectCalendarEventUpdate,
    TagCreate,
    TagResponse,
    TagUpdate,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
    TouchpointCreate,
    TouchpointResponse,
    TouchpointUpdate,
)

router = APIRouter(prefix="/api/v1/crm", tags=["crm"])

# ---------------------------------------------------------------------------
# Activity‑log helper — called by every write endpoint
# ---------------------------------------------------------------------------


async def _log_activity(
    db: AsyncSession,
    tenant_id: UUID,
    actor_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    summary: str | None = None,
    changes: dict | None = None,
    workspace_id: UUID | None = None,
) -> None:
    # Fallback: resolve tenant's default workspace when caller didn't pass one
    # (update/delete handlers historically omit it → NOT NULL violation on
    # activity_log). Same resolution path as get_tenant_session.
    if workspace_id is None:
        try:
            row = await db.execute(
                text("SELECT id FROM nexus_auth.workspaces WHERE tenant_id = :tid ORDER BY created_at ASC LIMIT 1"),
                {"tid": str(tenant_id)},
            )
            wid = row.scalar_one_or_none()
            if wid:
                workspace_id = UUID(str(wid))
        except Exception:
            pass
    entry = ActivityLog(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        changes=changes,
    )
    db.add(entry)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def _get_tenant_id(request: Request) -> UUID:
    # If token was valid but expired, return 401 so frontend refresh flow kicks in
    if getattr(request.state, "auth_status", "") == "expired":
        raise HTTPException(status_code=401, detail="Token expired")
    tid = request.state.tenant_id
    if not tid:
        raise HTTPException(status_code=403, detail="Tenant not identified")
    return tid


def _get_user_id(request: Request) -> UUID | None:
    return getattr(request.state, "user_id", None)


# ---------------------------------------------------------------------------
# Custom Field helpers — EAV batch load + write
# ---------------------------------------------------------------------------

async def _load_custom_fields(
    db: AsyncSession,
    tenant_id: UUID,
    module: str,
    record_ids: list[UUID],
) -> dict[str, dict[str, Any]]:
    """Batch-load custom fields for a list of record IDs.

    Returns {record_id_str: {field_key: value, ...}}
    """
    if not record_ids:
        return {}

    result = await db.execute(
        text("""
            SELECT v.record_id, d.field_key, d.field_type,
                   v.value_text, v.value_number, v.value_boolean, v.value_date, v.value_json
            FROM nexus_crm.get_custom_fields(:tenant_id, :module, :record_ids) v
            JOIN nexus_crm.custom_field_definitions d ON d.field_key = v.field_key
                AND d.module_name = :module2 AND d.tenant_id = :tenant_id2
        """),
        {
            "tenant_id": tenant_id,
            "module": module,
            "record_ids": record_ids,
            "module2": module,
            "tenant_id2": tenant_id,
        },
    )
    rows = result.all()  # force fetch before closing
    cf_map: dict[str, dict[str, Any]] = {}
    for row in rows:
        rid = str(row.record_id)
        if rid not in cf_map:
            cf_map[rid] = {}
        val = _extract_cf_value(row)
        if val is not None:
            cf_map[rid][row.field_key] = val
    return cf_map


def _extract_cf_value(row) -> Any:
    """Pick the right value column based on field_type."""
    ft = row.field_type
    if ft == "boolean":
        return row.value_boolean
    elif ft == "number":
        return row.value_number
    elif ft == "date":
        return row.value_date.isoformat() if row.value_date else None
    elif ft in ("select", "multi_select"):
        return row.value_text or row.value_json
    elif ft == "file":
        return row.value_json
    else:
        return row.value_text


async def _apply_task_cf(
    db: AsyncSession, tenant_id: UUID, task_id: UUID, custom_fields: dict[str, Any]
) -> None:
    """Write custom field values for a task (upsert via PG function)."""
    if not custom_fields:
        return
    # Get definition_id for each field_key
    result = await db.execute(
        text("""
            SELECT id, field_key FROM nexus_crm.custom_field_definitions
            WHERE tenant_id = :tenant_id AND module_name = 'tasks'
              AND field_key = ANY(:keys)
        """),
        {"tenant_id": tenant_id, "keys": list(custom_fields.keys())},
    )
    defs = {row.field_key: row.id for row in result}
    for key, val in custom_fields.items():
        def_id = defs.get(key)
        if not def_id:
            continue
        # Map value to correct type column
        params = {
            "p_tenant_id": tenant_id,
            "p_definition_id": def_id,
            "p_record_id": task_id,
            "p_value_text": None,
            "p_value_number": None,
            "p_value_boolean": None,
            "p_value_date": None,
            "p_value_json": None,
        }
        if isinstance(val, bool):
            params["p_value_boolean"] = val
        elif isinstance(val, (int, float)):
            params["p_value_number"] = val
        elif isinstance(val, (list, dict)):
            params["p_value_json"] = val
        elif isinstance(val, str):
            # Try date parse
            try:
                from datetime import date as d_type
                # just store as text for now
                params["p_value_text"] = val
            except Exception:
                params["p_value_text"] = val
        else:
            params["p_value_text"] = str(val) if val is not None else None

        await db.execute(
            text("""
                SELECT nexus_crm.upsert_custom_field_value(
                    :p_tenant_id, :p_definition_id, :p_record_id,
                    :p_value_text, :p_value_number, :p_value_boolean,
                    :p_value_date::timestamptz, :p_value_json::jsonb
                )
            """),
            params,
        )


async def _delete_task_cf(
    db: AsyncSession, tenant_id: UUID, task_id: UUID
) -> None:
    """Delete all custom field values for a task."""
    await db.execute(
        text("SELECT nexus_crm.delete_custom_field_values(:tid, 'tasks', :rid)"),
        {"tid": tenant_id, "rid": task_id},
    )


# ===========================================================================
# COMPANIES
# ===========================================================================


@router.get("/companies", response_model=ListResponse[CompanyResponse])
async def list_companies(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    industry: str | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Company).where(Company.tenant_id == tenant_id)

    if search:
        base = base.where(Company.name.ilike(f"%{search}%"))
    if industry:
        base = base.where(Company.industry == industry)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Company.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/companies", response_model=CompanyResponse, status_code=201)
async def create_company(
    request: Request,
    body: CompanyCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    company = Company(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        **body.model_dump(),
    )
    db.add(company)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="company",
        entity_id=company.id,
        summary=f"Created company '{company.name}'",
        workspace_id=workspace_id,
    )

    await db.refresh(company)
    return company


@router.get("/companies/{company_id}", response_model=CompanyResponse)
async def get_company(
    request: Request,
    company_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Company).where(Company.id == company_id, Company.tenant_id == tenant_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.patch("/companies/{company_id}", response_model=CompanyResponse)
async def update_company(
    request: Request,
    company_id: UUID,
    body: CompanyUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Company).where(Company.id == company_id, Company.tenant_id == tenant_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
        changes[field] = str(value)

    company.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="company",
        entity_id=company.id,
        summary=f"Updated company '{company.name}'",
        changes=changes,
    )

    await db.flush()
    await db.refresh(company)
    return company


@router.delete("/companies/{company_id}", status_code=204)
async def delete_company(
    request: Request,
    company_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Company).where(Company.id == company_id, Company.tenant_id == tenant_id)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    name = company.name
    await db.delete(company)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="company",
        entity_id=company_id,
        summary=f"Deleted company '{name}'",
    )

    return None


# ===========================================================================
# CONTACTS
# ===========================================================================


@router.get("/contacts", response_model=ListResponse[ContactResponse])
async def list_contacts(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    status: str | None = None,
    contact_type: str | None = None,
    grade: str | None = None,
    company_id: UUID | None = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Contact).where(Contact.tenant_id == tenant_id)

    if search:
        base = base.where(
            or_(
                Contact.name.ilike(f"%{search}%"),
                Contact.email.ilike(f"%{search}%"),
            )
        )
    if status:
        base = base.where(Contact.status == status)
    if contact_type:
        base = base.where(Contact.contact_type == contact_type)
    if grade:
        base = base.where(Contact.grade == grade)
    if company_id:
        base = base.where(Contact.company_id == company_id)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    sort_col = getattr(Contact, sort_by, None)
    if sort_col is None or not isinstance(sort_col.property, ColumnProperty):
        sort_col = Contact.created_at
    order = sort_col.asc() if sort_order == "asc" else sort_col.desc()
    items_q = base.options(selectinload(Contact.company)).order_by(order).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    # Build response with resolved company names
    items = []
    for c in rows:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        d['company'] = {"id": str(c.company.id), "name": c.company.name} if c.company else None
        items.append(d)

    return ListResponse(items=items, total=total)


@router.post("/contacts", response_model=ContactResponse, status_code=201)
async def create_contact(
    request: Request,
    body: ContactCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    contact = Contact(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        **body.model_dump(),
    )
    db.add(contact)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="contact",
        entity_id=contact.id,
        summary=f"Created contact '{contact.name}'",
        workspace_id=workspace_id,
    )

    await db.refresh(contact)
    # Re-query with company loaded (avoids MissingGreenlet on response serialization)
    result = await db.execute(
        select(Contact).options(selectinload(Contact.company)).where(Contact.id == contact.id)
    )
    contact = result.scalar_one()
    d = {col.name: getattr(contact, col.name) for col in contact.__table__.columns}
    d['company'] = {'id': str(contact.company.id), 'name': contact.company.name} if contact.company else None
    return d


@router.get("/contacts/{contact_id}", response_model=ContactResponse)
async def get_contact(
    request: Request,
    contact_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Contact).options(selectinload(Contact.company)).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    # Build response with resolved company name
    d = {col.name: getattr(contact, col.name) for col in contact.__table__.columns}
    d['company'] = {"id": str(contact.company.id), "name": contact.company.name} if contact.company else None
    return d


@router.patch("/contacts/{contact_id}", response_model=ContactResponse)
async def update_contact(
    request: Request,
    contact_id: UUID,
    body: ContactUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(contact, field, value)
        changes[field] = str(value)

    contact.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="contact",
        entity_id=contact.id,
        summary=f"Updated contact '{contact.name}'",
        changes=changes,
    )

    await db.flush()
    await db.refresh(contact)
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
async def delete_contact(
    request: Request,
    contact_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    name = contact.name
    await db.delete(contact)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="contact",
        entity_id=contact_id,
        summary=f"Deleted contact '{name}'",
    )

    return None


# ===========================================================================
# CONTACT PROJECTS (contact <-> deal junction)
# ===========================================================================


@router.get(
    "/contacts/{contact_id}/projects",
    response_model=ListResponse[ContactProjectResponse],
)
async def list_contact_projects(
    request: Request,
    contact_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)

    # Verify contact exists
    contact_result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    if not contact_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Contact not found")

    # Join contact_projects with deals and deal_stages
    from sqlalchemy import join

    j = (
        select(
            ContactProject,
            Deal.name.label("project_name"),
            Deal.amount.label("amount"),
            DealStage.name.label("stage_name"),
            DealStage.probability.label("probability"),
        )
        .select_from(
            join(
                ContactProject,
                Deal,
                ContactProject.project_id == Deal.id,
            ).join(
                DealStage,
                Deal.stage_id == DealStage.id,
                isouter=True,
            )
        )
        .where(
            ContactProject.tenant_id == tenant_id,
            ContactProject.contact_id == contact_id,
        )
        .order_by(ContactProject.created_at.desc())
    )

    rows = (await db.execute(j)).all()

    count_q = select(func.count()).select_from(
        select(ContactProject)
        .where(
            ContactProject.tenant_id == tenant_id,
            ContactProject.contact_id == contact_id,
        )
        .subquery()
    )
    total = (await db.execute(count_q)).scalar() or 0

    items = []
    for row in rows:
        item = ContactProjectResponse(
            id=row.id,
            tenant_id=row.tenant_id,
            contact_id=row.contact_id,
            project_id=row.project_id,
            role=row.role,
            created_at=row.created_at,
            project_name=row.project_name,
            amount=float(row.amount) if row.amount is not None else None,
            stage_name=row.stage_name,
            probability=row.probability,
        )
        items.append(item)

    return ListResponse(items=items, total=total)


@router.post(
    "/contacts/{contact_id}/projects",
    response_model=ContactProjectResponse,
    status_code=201,
)
async def create_contact_project(
    request: Request,
    contact_id: UUID,
    body: ContactProjectCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    # Verify contact exists
    contact_result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    contact = contact_result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Verify project (deal) exists
    deal_result = await db.execute(
        select(Deal).where(Deal.id == body.project_id, Deal.tenant_id == tenant_id)
    )
    deal = deal_result.scalar_one_or_none()
    if not deal:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check for existing link
    existing = await db.execute(
        select(ContactProject).where(
            ContactProject.tenant_id == tenant_id,
            ContactProject.contact_id == contact_id,
            ContactProject.project_id == body.project_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Contact is already linked to this project")

    link = ContactProject(
        tenant_id=tenant_id,
        contact_id=contact_id,
        project_id=body.project_id,
        role=body.role,
    )
    db.add(link)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="contact_project",
        entity_id=link.id,
        summary=f"Linked contact '{contact.name}' to project '{deal.name}'",
    )

    await db.refresh(link)
    return ContactProjectResponse(
        id=link.id,
        tenant_id=link.tenant_id,
        contact_id=link.contact_id,
        project_id=link.project_id,
        role=link.role,
        created_at=link.created_at,
    )


@router.delete(
    "/contacts/{contact_id}/projects/{project_id}",
    status_code=204,
)
async def delete_contact_project(
    request: Request,
    contact_id: UUID,
    project_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(ContactProject).where(
            ContactProject.tenant_id == tenant_id,
            ContactProject.contact_id == contact_id,
            ContactProject.project_id == project_id,
        )
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="Contact-project link not found")

    await db.delete(link)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="contact_project",
        entity_id=link.id,
        summary="Unlinked contact from project",
    )

    return None


# ===========================================================================
# TOUCHPOINTS
# ===========================================================================


@router.get("/touchpoints", response_model=ListResponse[TouchpointResponse])
async def list_touchpoints(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    contact_id: UUID | None = None,
    company_id: UUID | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Touchpoint).where(Touchpoint.tenant_id == tenant_id)

    if contact_id:
        base = base.where(
            Touchpoint.id.in_(
                select(TouchpointParticipant.touchpoint_id).where(
                    TouchpointParticipant.contact_id == contact_id,
                    TouchpointParticipant.tenant_id == tenant_id,
                )
            )
        )

    if company_id:
        base = base.where(Touchpoint.company_id == company_id)

    if search:
        base = base.where(Touchpoint.title.ilike(f"%{search}%"))

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.options(selectinload(Touchpoint.company), selectinload(Touchpoint.participants)).order_by(Touchpoint.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    items = []
    for t in rows:
        d = {col.name: getattr(t, col.name) for col in t.__table__.columns}
        d['company'] = {'id': str(t.company.id), 'name': t.company.name} if t.company else None
        d['participants'] = [{'id': str(p.id), 'name': p.name} for p in t.participants]
        items.append(d)

    return ListResponse(items=items, total=total)


@router.post("/touchpoints", response_model=TouchpointResponse, status_code=201)
async def create_touchpoint(
    request: Request,
    body: TouchpointCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    data = body.model_dump(exclude={"contact_ids"})
    touchpoint = Touchpoint(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        created_by=user_id,
        **data,
    )
    db.add(touchpoint)
    await db.flush()

    # Create participant records
    for cid in body.contact_ids:
        participant = TouchpointParticipant(
            tenant_id=tenant_id,
            touchpoint_id=touchpoint.id,
            contact_id=cid,
        )
        db.add(participant)

    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="touchpoint",
        entity_id=touchpoint.id,
        summary=f"Created touchpoint '{touchpoint.title}'",
        workspace_id=workspace_id,
    )

    await db.refresh(touchpoint)
    # Re-query with participants loaded
    result = await db.execute(
        select(Touchpoint).options(selectinload(Touchpoint.company), selectinload(Touchpoint.participants)).where(Touchpoint.id == touchpoint.id)
    )
    t = result.scalar_one()
    d = {col.name: getattr(t, col.name) for col in t.__table__.columns}
    d['company'] = {'id': str(t.company.id), 'name': t.company.name} if t.company else None
    d['participants'] = [{'id': str(p.id), 'name': p.name} for p in t.participants]
    return d


@router.get("/touchpoints/{touchpoint_id}", response_model=TouchpointResponse)
async def get_touchpoint(
    request: Request,
    touchpoint_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Touchpoint).options(selectinload(Touchpoint.company), selectinload(Touchpoint.participants)).where(
            Touchpoint.id == touchpoint_id, Touchpoint.tenant_id == tenant_id
        )
    )
    touchpoint = result.scalar_one_or_none()
    if not touchpoint:
        raise HTTPException(status_code=404, detail="Touchpoint not found")
    d = {col.name: getattr(touchpoint, col.name) for col in touchpoint.__table__.columns}
    d['company'] = {'id': str(touchpoint.company.id), 'name': touchpoint.company.name} if touchpoint.company else None
    d['participants'] = [{'id': str(p.id), 'name': p.name} for p in touchpoint.participants]
    return d


@router.patch("/touchpoints/{touchpoint_id}", response_model=TouchpointResponse)
async def update_touchpoint(
    request: Request,
    touchpoint_id: UUID,
    body: TouchpointUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Touchpoint).where(
            Touchpoint.id == touchpoint_id, Touchpoint.tenant_id == tenant_id
        )
    )
    touchpoint = result.scalar_one_or_none()
    if not touchpoint:
        raise HTTPException(status_code=404, detail="Touchpoint not found")

    changes = {}
    data = body.model_dump(exclude_unset=True)
    contact_ids = data.pop("contact_ids", None)
    for field, value in data.items():
        setattr(touchpoint, field, value)
        changes[field] = str(value)

    # Sync participants if contact_ids provided
    if contact_ids is not None:
        # Remove existing participants
        await db.execute(
            text("DELETE FROM nexus_crm.touchpoint_participants WHERE touchpoint_id = :tp_id AND tenant_id = :t_id"),
            {"tp_id": touchpoint_id, "t_id": tenant_id},
        )
        # Add new participants
        for cid in contact_ids:
            participant = TouchpointParticipant(
                tenant_id=tenant_id,
                touchpoint_id=touchpoint.id,
                contact_id=cid,
            )
            db.add(participant)

    touchpoint.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="touchpoint",
        entity_id=touchpoint.id,
        summary=f"Updated touchpoint '{touchpoint.title}'",
        changes=changes,
    )

    await db.flush()
    # Re-query with participants loaded
    result = await db.execute(
        select(Touchpoint).options(selectinload(Touchpoint.company), selectinload(Touchpoint.participants)).where(Touchpoint.id == touchpoint.id)
    )
    t = result.scalar_one()
    d = {col.name: getattr(t, col.name) for col in t.__table__.columns}
    d['company'] = {'id': str(t.company.id), 'name': t.company.name} if t.company else None
    d['participants'] = [{'id': str(p.id), 'name': p.name} for p in t.participants]
    return d


@router.delete("/touchpoints/{touchpoint_id}", status_code=204)
async def delete_touchpoint(
    request: Request,
    touchpoint_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Touchpoint).where(
            Touchpoint.id == touchpoint_id, Touchpoint.tenant_id == tenant_id
        )
    )
    touchpoint = result.scalar_one_or_none()
    if not touchpoint:
        raise HTTPException(status_code=404, detail="Touchpoint not found")

    title = touchpoint.title
    await db.delete(touchpoint)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="touchpoint",
        entity_id=touchpoint_id,
        summary=f"Deleted touchpoint '{title}'",
    )

    return None


# ===========================================================================
# TASKS
# ===========================================================================


@router.get("/tasks", response_model=ListResponse[TaskResponse])
async def list_tasks(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    status: str | None = None,
    status_not: str | None = None,
    priority: str | None = None,
    priority_not: str | None = None,
    contact_id: UUID | None = None,
    company_id: UUID | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Task).where(Task.tenant_id == tenant_id)

    if search:
        base = base.where(Task.title.ilike(f"%{search}%"))
    if status:
        vals = [v.strip() for v in status.split(',') if v.strip()]
        if len(vals) == 1:
            base = base.where(Task.status == vals[0])
        else:
            base = base.where(Task.status.in_(vals))
    if status_not:
        vals = [v.strip() for v in status_not.split(',') if v.strip()]
        if len(vals) == 1:
            base = base.where(Task.status != vals[0])
        else:
            base = base.where(Task.status.notin_(vals))
    if priority:
        vals = [v.strip() for v in priority.split(',') if v.strip()]
        if len(vals) == 1:
            base = base.where(Task.priority == vals[0])
        else:
            base = base.where(Task.priority.in_(vals))
    if priority_not:
        vals = [v.strip() for v in priority_not.split(',') if v.strip()]
        if len(vals) == 1:
            base = base.where(Task.priority != vals[0])
        else:
            base = base.where(Task.priority.notin_(vals))
    if contact_id:
        base = base.where(Task.contact_id == contact_id)
    if company_id:
        base = base.where(Task.company_id == company_id)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.options(selectinload(Task.company)).order_by(Task.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    # Batch-load custom fields
    task_ids = [t.id for t in rows]
    cf_map = await _load_custom_fields(db, tenant_id, "tasks", task_ids)

    # Build response with resolved company names + custom fields
    items = []
    for t in rows:
        d = {col.name: getattr(t, col.name) for col in t.__table__.columns}
        d['company'] = {'id': str(t.company.id), 'name': t.company.name} if t.company else None
        d['custom_fields'] = cf_map.get(str(t.id), {})
        # Ensure native fields from model are present
        d['parent_task_id'] = str(t.parent_task_id) if t.parent_task_id else None
        d['recurring'] = t.recurring
        d['area'] = t.area
        items.append(d)

    return ListResponse(items=items, total=total)


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def create_task(
    request: Request,
    body: TaskCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    task = Task(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        created_by=user_id,
        **body.model_dump(exclude={'custom_fields'}),
    )
    db.add(task)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="task",
        entity_id=task.id,
        summary=f"Created task '{task.title}'",
        workspace_id=workspace_id,
    )

    # Write custom fields if provided
    if body.custom_fields:
        await _apply_task_cf(db, tenant_id, task.id, body.custom_fields)

    await db.refresh(task)
    # Return with custom fields
    d = {col.name: getattr(task, col.name) for col in task.__table__.columns}
    d['company'] = None
    cf_map = await _load_custom_fields(db, tenant_id, "tasks", [task.id])
    d['custom_fields'] = cf_map.get(str(task.id), {})
    d['parent_task_id'] = str(task.parent_task_id) if task.parent_task_id else None
    d['recurring'] = task.recurring
    d['area'] = task.area
    return d


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    request: Request,
    task_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Task).options(selectinload(Task.company)).where(Task.id == task_id, Task.tenant_id == tenant_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    # Build response with resolved company name + custom fields
    d = {col.name: getattr(task, col.name) for col in task.__table__.columns}
    d['company'] = {'id': str(task.company.id), 'name': task.company.name} if task.company else None
    cf_map = await _load_custom_fields(db, tenant_id, "tasks", [task.id])
    d['custom_fields'] = cf_map.get(str(task.id), {})
    d['parent_task_id'] = str(task.parent_task_id) if task.parent_task_id else None
    d['recurring'] = task.recurring
    d['area'] = task.area
    return d


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    request: Request,
    task_id: UUID,
    body: TaskUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.tenant_id == tenant_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = {}
    body_dict = body.model_dump(exclude_unset=True)
    cf_update = body_dict.pop('custom_fields', None)

    for field, value in body_dict.items():
        setattr(task, field, value)
        changes[field] = str(value)

    task.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="task",
        entity_id=task.id,
        summary=f"Updated task '{task.title}'",
        changes=changes,
    )

    # Update custom fields if provided
    if cf_update is not None:
        await _delete_task_cf(db, tenant_id, task.id)
        await _apply_task_cf(db, tenant_id, task.id, cf_update)

    await db.flush()
    await db.refresh(task)

    # Return with custom fields
    d = {col.name: getattr(task, col.name) for col in task.__table__.columns}
    d['company'] = {'id': str(task.company.id), 'name': task.company.name} if task.company else None
    cf_map = await _load_custom_fields(db, tenant_id, "tasks", [task.id])
    d['custom_fields'] = cf_map.get(str(task.id), {})
    d['parent_task_id'] = str(task.parent_task_id) if task.parent_task_id else None
    d['recurring'] = task.recurring
    d['area'] = task.area
    return d


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    request: Request,
    task_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.tenant_id == tenant_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    title = task.title
    # Delete custom fields first
    await _delete_task_cf(db, tenant_id, task.id)
    await db.delete(task)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="task",
        entity_id=task_id,
        summary=f"Deleted task '{title}'",
    )

    return None


# ===========================================================================
# NAME CARDS
# ===========================================================================


@router.get("/name-cards", response_model=ListResponse[NameCardResponse])
async def list_name_cards(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(NameCard).where(NameCard.tenant_id == tenant_id)

    if search:
        base = base.where(NameCard.raw_ocr_text.ilike(f"%{search}%"))

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(NameCard.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/name-cards", response_model=NameCardResponse, status_code=201)
async def create_name_card(
    request: Request,
    body: NameCardCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    name_card = NameCard(
        tenant_id=tenant_id,
        **body.model_dump(),
    )
    db.add(name_card)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="name_card",
        entity_id=name_card.id,
        summary="Created name card entry",
    )

    await db.refresh(name_card)
    return name_card


# ── NameCard upload → OCR → auto-create/link Contact ───────────────────
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "namecards"


@router.post("/name-cards/upload", response_model=NameCardResponse, status_code=201)
async def upload_name_card(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_tenant_session),
):
    """Upload a namecard image → OCR → auto-create/link a Contact.

    Pipeline:
      1. Save image to backend/uploads/namecards/{uuid}.{ext}
      2. tesseract OCR (chi_tra+eng) → raw text
      3. Heuristic parse → structured fields
      4. Company: match by name (exact, then case-insensitive) → create if missing
      5. Contact: dedup by email (else phone, else name) → link or create
      6. Store NameCard row with image_url / raw_ocr_text / parsed_data / contact_id
    """
    import uuid as _uuid
    from pathlib import Path as _Path

    from app.services import namecard_ocr

    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    # 1. Save image
    ext = _Path(file.filename or "card.jpg").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    card_id = _uuid.uuid4()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    rel_path = f"{card_id}{ext}"
    abs_path = UPLOAD_DIR / rel_path
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    abs_path.write_bytes(content)

    original_image_url = f"/api/v1/crm/name-cards/image/{rel_path}"
    image_url = original_image_url  # default display = original until crop verified

    # 2. Crop + OCR-verify: keep a crop only if it preserves card content.
    from app.services import namecard_crop_pipeline
    crop_result = namecard_crop_pipeline.crop_card_best(abs_path)
    crop_path = None
    cropped_image_url = None
    if crop_result["crop"] is not None:
        try:
            crop_path = namecard_crop_pipeline.save_crop(crop_result["crop"], abs_path)
            if namecard_ocr.verify_crop(abs_path, crop_path):
                cropped_image_url = f"/api/v1/crm/name-cards/image/{crop_path.name}"
            else:
                crop_path.unlink(missing_ok=True)
                crop_path = None
        except OSError:
            crop_path = None

    # 3. OCR — use the verified crop when available (cleaner input → better parse)
    ocr_source = crop_path if crop_path is not None else abs_path
    raw_text = namecard_ocr.ocr_image(ocr_source)
    parsed = namecard_ocr.parse_namecard(raw_text) if raw_text else {}

    # 3.5 Agent pipeline — Ingestion → Extraction (LLM JSON mode, fail-safe)
    s1 = namecard_agents.ingestion_agent(raw_text, parsed, image_url)
    await namecard_agents.persist_step(
        db, tenant_id=tenant_id, signal_id=card_id, step=s1)
    s2 = namecard_agents.extraction_agent(s1.output["signal"])
    await namecard_agents.persist_step(
        db, tenant_id=tenant_id, signal_id=card_id, step=s2)
    parsed = s2.output["parsed"]

    # 3. Company match/create (normalised exact → fuzzy → create + enrich)
    company_id = None
    company_name = (parsed.get("company") or "").strip()
    comp = None
    if company_name:
        _norm = namecard_llm.normalize_company_name(company_name)
        if _norm:
            comp = (
                await db.execute(
                    select(Company).where(
                        Company.tenant_id == tenant_id,
                        func.lower(Company.name) == company_name.lower(),
                    )
                )
            ).scalar_one_or_none()
            if comp is None and _norm:
                # fuzzy: normalised name contains the other (case-insensitive)
                comp_rows = (
                    await db.execute(
                        select(Company).where(Company.tenant_id == tenant_id)
                    )
                ).scalars().all()
                for _c in comp_rows:
                    _cn = namecard_llm.normalize_company_name(_c.name or "")
                    if _cn and (_norm in _cn or _cn in _norm):
                        comp = _c
                        break
    if company_name and comp is None:
        # Enrichment Agent — web research (Perplexity; {} on failure)
        s4 = namecard_agents.enrichment_agent(company_name)
        await namecard_agents.persist_step(
            db, tenant_id=tenant_id, signal_id=card_id, step=s4)
        research = s4.output.get("research") or {}
        comp = Company(
            tenant_id=tenant_id, workspace_id=workspace_id, name=company_name,
            website=research.get("website") or None,
            industry=research.get("industry") or None,
            address=research.get("address") or None,
            size=research.get("size") or None,
            notes=research.get("description") or None,
            enriched_by_ai=bool(research),
            enrichment_source_url=research.get("source_url") or None,
            data_completeness_pct=namecard_agents.company_completeness_pct(
                {"name": company_name, **research}),
        )
        db.add(comp)
        await db.flush()
        await _log_activity(
            db, tenant_id=tenant_id, actor_id=user_id,
            action="created", entity_type="company", entity_id=comp.id,
            summary=f"Created company '{company_name}' (from namecard, web-enriched)",
            workspace_id=workspace_id,
        )
    company_id = comp.id if comp else None

    # 4. Contact dedup — Entity Resolution Agent (3-layer, tiered routing)
    contact_id = None
    status = "pending"
    dedup_status = "none"
    review_candidates: list[dict] = []
    email = (parsed.get("email") or "").strip().lower()
    phone = (parsed.get("phone") or "").strip()
    person_name = (parsed.get("name") or "").strip()

    # Gather tenant contacts once (with company names for the agent)
    cand_rows = (
        await db.execute(
            select(Contact)
            .options(selectinload(Contact.company))
            .where(Contact.tenant_id == tenant_id)
        )
    ).scalars().all()
    existing_contacts = [{
        "id": str(c.id), "name": c.name, "chinese_name": c.chinese_name,
        "job_title": c.job_title,
        "company_id": str(c.company_id) if c.company_id else "",
        "company_name": c.company.name if c.company else "",
        "email": c.email, "phone": c.phone, "office_phone": c.office_phone,
    } for c in cand_rows]

    s3 = namecard_agents.entity_resolution_agent(parsed, existing_contacts, company_id)
    await namecard_agents.persist_step(
        db, tenant_id=tenant_id, signal_id=card_id, step=s3)
    resolution = s3.output
    candidate = resolution.get("candidate")
    conf = s3.confidence

    if s3.decision == "auto_link" and candidate:
        # HIGH tier (>0.95): exact match → auto link, log only
        existing = next(
            (c for c in cand_rows if str(c.id) == candidate["id"]), None)
        if existing is not None:
            contact_id = existing.id
            status = "matched"
            dedup_status = "auto_matched"
            existing.dedup_status = "auto_matched"
            existing.confidence_score = conf
            existing.last_verified_at = datetime.now(timezone.utc)
            existing.source_signal_id = card_id
            # Backfill missing fields from the card (never overwrite existing)
            updates = {}
            if not existing.email and email:
                updates["email"] = email
            if not existing.phone and phone:
                updates["phone"] = phone
            if not existing.job_title and parsed.get("title"):
                updates["job_title"] = parsed["title"]
            if not existing.company_id and company_id:
                updates["company_id"] = company_id
            if updates:
                for k, v in updates.items():
                    setattr(existing, k, v)
                await _log_activity(
                    db, tenant_id=tenant_id, actor_id=user_id,
                    action="updated", entity_type="contact", entity_id=existing.id,
                    summary=f"Backfilled contact from namecard: {', '.join(updates)}", workspace_id=workspace_id,
                )
    elif s3.decision == "review" and candidate:
        # MEDIUM tier (0.7-0.95): user decides override vs keep-both
        status = "review"
        dedup_status = "llm_review"
        review_candidates = [{
            "contact_id": candidate["id"],
            "confidence": round(conf, 2),
            "reason": resolution.get("reason", ""),
            "name": candidate["name"], "email": candidate["email"],
            "phone": candidate["phone"], "company": candidate["company"],
            "title": candidate["title"],
        }]
    elif person_name:
        # LOW tier / no candidates — create (flag unresolved when weak)
        contact = Contact(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            name=person_name,
            chinese_name=(parsed.get("chinese_name") or "").strip() or None,
            email=email or None,
            phone=phone or None,
            office_phone=(parsed.get("office_phone") or "").strip() or None,
            job_title=(parsed.get("title") or "").strip() or None,
            company_id=company_id,
            address=(parsed.get("address") or "").strip() or None,
            source="namecard",
            namecard_path=image_url,
            source_signal_id=card_id,
            confidence_score=conf if conf else None,
            dedup_status="unresolved" if resolution.get("tier") == "low" else "none",
            last_verified_at=datetime.now(timezone.utc),
            custom_fields={
                "namecard_website": parsed.get("website") or "",
                "namecard_linkedin": parsed.get("linkedin") or "",
            },
        )
        db.add(contact)
        await db.flush()
        contact_id = contact.id
        status = "created"
        # LOW tier weak hint → surface candidate for later manual review
        if resolution.get("tier") == "low" and candidate:
            review_candidates = [{
                "contact_id": candidate["id"],
                "confidence": round(conf, 2),
                "reason": resolution.get("reason", ""),
                "name": candidate["name"], "email": candidate["email"],
                "phone": candidate["phone"], "company": candidate["company"],
                "title": candidate["title"],
            }]
        await _log_activity(
            db, tenant_id=tenant_id, actor_id=user_id,
            action="created", entity_type="contact", entity_id=contact.id,
            summary=f"Created contact '{person_name}' from namecard", workspace_id=workspace_id,
        )

    # 4.5 AI context suggestion — could this person have been met recently?
    context_note = ""
    try:
        recent_tps = (
            await db.execute(
                select(Touchpoint).where(
                    Touchpoint.tenant_id == tenant_id,
                    Touchpoint.type.in_(["meeting", "call", "event"]),
                    Touchpoint.date >= datetime.now(timezone.utc) - timedelta(days=30),
                ).order_by(Touchpoint.date.desc()).limit(10)
            )
        ).scalars().all()
        if recent_tps:
            _events = [{"title": t.title, "date": str(t.date),
                        "location": t.location or ""} for t in recent_tps]
            s5 = namecard_agents.inference_agent(parsed, _events)
            await namecard_agents.persist_step(
                db, tenant_id=tenant_id, signal_id=card_id, step=s5)
            if s5.output.get("suggestion"):
                context_note = s5.output["suggestion"]
                parsed["context_note"] = context_note
                parsed["context_match"] = s5.output.get("matched_event") or ""
    except Exception:  # noqa: BLE001 — enrichment never breaks upload
        context_note = ""

    # 5. Store NameCard row
    name_card = NameCard(
        id=card_id,
        tenant_id=tenant_id,
        contact_id=contact_id,
        image_url=image_url,
        original_image_url=original_image_url,
        cropped_image_url=cropped_image_url,
        display_image="cropped" if cropped_image_url else "original",
        raw_ocr_text=raw_text,
        parsed_data=parsed,
        review_candidates=review_candidates if status == "review" else [],
        dedup_status=dedup_status,
        status=status,
        matched_by=user_id,
    )
    db.add(name_card)
    await db.flush()
    await _log_activity(
        db, tenant_id=tenant_id, actor_id=user_id,
        action="created", entity_type="name_card", entity_id=name_card.id,
        summary=f"Uploaded namecard → {status}" + (f" ({person_name})" if person_name else ""),
        workspace_id=workspace_id,
    )

    await db.flush()
    await db.refresh(name_card)
    return name_card


@router.get("/name-cards/image/{filename}")
async def name_card_image(
    request: Request,
    filename: str,
):
    """Serve a stored namecard image (authenticated)."""
    from fastapi.responses import FileResponse

    # Path traversal guard
    safe = Path(filename).name
    path = UPLOAD_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


@router.get("/name-cards/{name_card_id}", response_model=NameCardResponse)
async def get_name_card(
    request: Request,
    name_card_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(NameCard).where(
            NameCard.id == name_card_id, NameCard.tenant_id == tenant_id
        )
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")
    return name_card


@router.patch("/name-cards/{name_card_id}", response_model=NameCardResponse)
async def update_name_card(
    request: Request,
    name_card_id: UUID,
    body: NameCardUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(NameCard).where(
            NameCard.id == name_card_id, NameCard.tenant_id == tenant_id
        )
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "display_image":
            if value not in ("original", "cropped"):
                raise HTTPException(status_code=422, detail="display_image must be 'original' or 'cropped'")
            target_url = name_card.original_image_url if value == "original" else name_card.cropped_image_url
            if not target_url:
                raise HTTPException(status_code=422, detail=f"No {value} image exists on this card")
            name_card.display_image = value
            name_card.image_url = target_url  # keep legacy field in sync
            changes[field] = str(value)
            continue
        setattr(name_card, field, value)
        changes[field] = str(value)

    name_card.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="name_card",
        entity_id=name_card.id,
        summary="Updated name card",
        changes=changes,
    )

    await db.flush()
    await db.refresh(name_card)
    return name_card


@router.delete("/name-cards/{name_card_id}", status_code=204)
async def delete_name_card(
    request: Request,
    name_card_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(NameCard).where(
            NameCard.id == name_card_id, NameCard.tenant_id == tenant_id
        )
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")

    await db.delete(name_card)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="name_card",
        entity_id=name_card_id,
        summary="Deleted name card",
    )

    return None


def _resolve_image_file(url: str | None) -> Path | None:
    """Map a stored image URL to its file on disk (name-guarded)."""
    if not url:
        return None
    path = UPLOAD_DIR / Path(url.rsplit("/", 1)[-1]).name
    return path if path.is_file() else None


@router.delete("/name-cards/{name_card_id}/image/{variant}", response_model=NameCardResponse)
async def delete_name_card_image(
    request: Request,
    name_card_id: UUID,
    variant: str,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Delete one image version (original | cropped).

    The remaining version automatically becomes the default; if both are gone
    the card has no image at all.
    """
    if variant not in ("original", "cropped"):
        raise HTTPException(status_code=422, detail="variant must be 'original' or 'cropped'")
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(NameCard).where(NameCard.id == name_card_id, NameCard.tenant_id == tenant_id)
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")

    url = name_card.original_image_url if variant == "original" else name_card.cropped_image_url
    if not url:
        raise HTTPException(status_code=404, detail=f"No {variant} image on this card")

    fpath = _resolve_image_file(url)
    if fpath is not None:
        try:
            fpath.unlink()
        except OSError:
            pass

    if variant == "original":
        name_card.original_image_url = None
    else:
        name_card.cropped_image_url = None

    # Auto-switch default: the remaining version wins; none left → no image.
    remaining = name_card.cropped_image_url if variant == "original" else name_card.original_image_url
    if remaining:
        name_card.display_image = "cropped" if name_card.cropped_image_url else "original"
        name_card.image_url = remaining
    else:
        name_card.display_image = None
        name_card.image_url = None

    name_card.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="name_card",
        entity_id=name_card.id,
        summary=f"Deleted {variant} image from name card",
        changes={"image_removed": variant, "display_image": name_card.display_image},
    )

    await db.flush()
    await db.refresh(name_card)
    return name_card


@router.post("/name-cards/{name_card_id}/recrop", response_model=NameCardResponse)
async def recrop_name_card(
    request: Request,
    name_card_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    """(Re)generate the cropped version for an existing card, OCR-verified."""
    from app.services import namecard_crop_pipeline
    from app.services import namecard_ocr

    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(NameCard).where(NameCard.id == name_card_id, NameCard.tenant_id == tenant_id)
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")

    src_path = _resolve_image_file(name_card.original_image_url or name_card.image_url)
    if src_path is None:
        raise HTTPException(status_code=404, detail="Source image file missing")

    crop_result = namecard_crop_pipeline.crop_card_best(src_path)
    if crop_result["crop"] is None:
        raise HTTPException(status_code=422, detail=f"Crop failed ({crop_result['method']})")

    crop_path = namecard_crop_pipeline.save_crop(crop_result["crop"], src_path)
    if not namecard_ocr.verify_crop(src_path, crop_path):
        crop_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail="Crop rejected: OCR verification found content cut off",
        )

    cropped_url = f"/api/v1/crm/name-cards/image/{crop_path.name}"
    name_card.cropped_image_url = cropped_url
    if name_card.display_image != "original":
        name_card.display_image = "cropped"
        name_card.image_url = cropped_url
    name_card.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="name_card",
        entity_id=name_card.id,
        summary=f"Regenerated crop ({crop_result['method']})",
        changes={"cropped_image_url": cropped_url, "method": crop_result["method"]},
    )

    await db.flush()
    await db.refresh(name_card)
    return name_card


@router.post("/name-cards/{name_card_id}/resolve", response_model=NameCardResponse)
async def resolve_name_card(
    request: Request,
    name_card_id: UUID,
    body: NameCardResolveRequest,
    db: AsyncSession = Depends(get_tenant_session),
):
    """User decision on a review-status card (LLM flagged potential duplicate).

    action='overwrite' → update the existing contact with card data.
    action='keep_both' → create a new contact (keep both records).
    """
    if body.action not in ("overwrite", "keep_both"):
        raise HTTPException(status_code=422, detail="action must be 'overwrite' or 'keep_both'")
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(NameCard).where(NameCard.id == name_card_id, NameCard.tenant_id == tenant_id)
    )
    name_card = result.scalar_one_or_none()
    if not name_card:
        raise HTTPException(status_code=404, detail="NameCard not found")
    if name_card.status != "review" or not name_card.review_candidates:
        raise HTTPException(status_code=422, detail="Card is not awaiting review")

    parsed = name_card.parsed_data or {}
    email = (parsed.get("email") or "").strip().lower()
    phone = (parsed.get("phone") or "").strip()
    person_name = (parsed.get("name") or "").strip()
    cand = name_card.review_candidates[0]
    target_id = body.contact_id or UUID(cand["contact_id"])

    if body.action == "overwrite":
        existing = (
            await db.execute(
                select(Contact).where(Contact.id == target_id, Contact.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if not existing:
            raise HTTPException(status_code=404, detail="Target contact not found")
        updates = []
        if parsed.get("name"):
            existing.name = parsed["name"]; updates.append("name")
        if parsed.get("chinese_name"):
            existing.chinese_name = parsed["chinese_name"]; updates.append("chinese_name")
        if email:
            existing.email = email; updates.append("email")
        if phone:
            existing.phone = phone; updates.append("phone")
        if parsed.get("title"):
            existing.job_title = parsed["title"]; updates.append("job_title")
        if parsed.get("address"):
            existing.address = parsed["address"]; updates.append("address")
        cf = dict(existing.custom_fields or {})
        if parsed.get("website"):
            cf["namecard_website"] = parsed["website"]
        if parsed.get("linkedin"):
            cf["namecard_linkedin"] = parsed["linkedin"]
        existing.custom_fields = cf
        contact_id = existing.id
        await _log_activity(
            db, tenant_id=tenant_id, actor_id=user_id,
            action="updated", entity_type="contact", entity_id=existing.id,
            summary=f"Overwrote contact from namecard review: {', '.join(updates) or 'custom_fields'}",
            workspace_id=getattr(request.state, "workspace_id", None),
        )
        new_status = "matched"
    else:  # keep_both — create a fresh contact, leave the existing one untouched
        contact = Contact(
            tenant_id=tenant_id,
            workspace_id=getattr(request.state, "workspace_id", None),
            name=person_name,
            chinese_name=(parsed.get("chinese_name") or "").strip() or None,
            email=email or None,
            phone=phone or None,
            job_title=(parsed.get("title") or "").strip() or None,
            address=(parsed.get("address") or "").strip() or None,
            source="namecard",
            namecard_path=name_card.image_url,
            custom_fields={
                "namecard_website": parsed.get("website") or "",
                "namecard_linkedin": parsed.get("linkedin") or "",
            },
        )
        db.add(contact)
        await db.flush()
        contact_id = contact.id
        await _log_activity(
            db, tenant_id=tenant_id, actor_id=user_id,
            action="created", entity_type="contact", entity_id=contact.id,
            summary=f"Created contact '{person_name}' (kept both from namecard review)",
            workspace_id=getattr(request.state, "workspace_id", None),
        )
        new_status = "created"

    name_card.contact_id = contact_id
    name_card.status = new_status
    name_card.review_candidates = []
    name_card.dedup_status = "user_override"
    name_card.matched_by = user_id
    name_card.updated_at = datetime.now(timezone.utc)

    # Record the human's decision on the entity-resolution step (audit + calibration)
    user_decision = "accept" if body.action == "overwrite" else "reject"
    try:
        await db.execute(
            text(
                "UPDATE nexus_crm.ai_agent_log "
                "SET user_decision = :ud WHERE signal_id = :sid "
                "AND agent_name = 'entity_resolution'"
            ),
            {"ud": user_decision, "sid": name_card.id},
        )
        # Mark the contact's dedup status resolved
        await db.execute(
            text(
                "UPDATE nexus_crm.contacts SET dedup_status = :ds, "
                "last_verified_at = now() WHERE id = :cid"
            ),
            {"ds": "user_override" if body.action == "overwrite" else "none",
             "cid": contact_id},
        )
    except Exception:  # noqa: BLE001 — audit write must never fail the resolve
        pass

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="name_card",
        entity_id=name_card.id,
        summary=f"Resolved namecard review → {body.action}",
        changes={"action": body.action, "status": new_status},
    )

    await db.flush()
    await db.refresh(name_card)
    return name_card


@router.get("/notes", response_model=ListResponse[NoteResponse])
async def list_notes(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    company_id: UUID | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Note).where(Note.tenant_id == tenant_id)

    if search:
        base = base.where(
            or_(
                Note.title.ilike(f"%{search}%"),
                Note.content.ilike(f"%{search}%"),
            )
        )

    if company_id:
        base = base.where(Note.company_id == company_id)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.options(selectinload(Note.company)).order_by(Note.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    # Build response with resolved company names
    items = []
    for n in rows:
        d = {col.name: getattr(n, col.name) for col in n.__table__.columns}
        d['company'] = {'id': str(n.company.id), 'name': n.company.name} if n.company else None
        items.append(d)

    return ListResponse(items=items, total=total)


@router.post("/notes", response_model=NoteResponse, status_code=201)
async def create_note(
    request: Request,
    body: NoteCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    note = Note(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        created_by=user_id,
        **body.model_dump(),
    )
    db.add(note)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="note",
        entity_id=note.id,
        summary=f"Created note '{note.title or '(untitled)'}'",
        workspace_id=workspace_id,
    )

    await db.refresh(note)
    return note


@router.get("/notes/{note_id}", response_model=NoteResponse)
async def get_note(
    request: Request,
    note_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Note).options(selectinload(Note.company)).where(Note.id == note_id, Note.tenant_id == tenant_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    # Build response with resolved company name
    d = {col.name: getattr(note, col.name) for col in note.__table__.columns}
    d['company'] = {'id': str(note.company.id), 'name': note.company.name} if note.company else None
    return d


@router.patch("/notes/{note_id}", response_model=NoteResponse)
async def update_note(
    request: Request,
    note_id: UUID,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.tenant_id == tenant_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
        changes[field] = str(value)

    note.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="note",
        entity_id=note.id,
        summary=f"Updated note '{note.title or '(untitled)'}'",
        changes=changes,
    )

    await db.flush()
    await db.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
async def delete_note(
    request: Request,
    note_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Note).where(Note.id == note_id, Note.tenant_id == tenant_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    title = note.title
    await db.delete(note)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="note",
        entity_id=note_id,
        summary=f"Deleted note '{title or '(untitled)'}'",
    )

    return None


# ===========================================================================
# ACTIVITY LOG  (read‑only + create; no update / delete)
# ===========================================================================


@router.get("/activity-log", response_model=ListResponse[ActivityLogResponse])
async def list_activity_log(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    entity_type: str | None = None,
    action: str | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(ActivityLog).where(ActivityLog.tenant_id == tenant_id)

    if entity_type:
        base = base.where(ActivityLog.entity_type == entity_type)
    if action:
        base = base.where(ActivityLog.action == action)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(ActivityLog.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/activity-log", response_model=ActivityLogResponse, status_code=201)
async def create_activity_log_entry(
    request: Request,
    body: ActivityLogCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    entry = ActivityLog(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        actor_id=user_id or body.actor_id if hasattr(body, "actor_id") else user_id,
        **body.model_dump(),
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


@router.get("/activity-log/{log_id}", response_model=ActivityLogResponse)
async def get_activity_log_entry(
    request: Request,
    log_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(ActivityLog).where(
            ActivityLog.id == log_id, ActivityLog.tenant_id == tenant_id
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="ActivityLog entry not found")
    return entry


# ===========================================================================
# TAGS
# ===========================================================================


@router.get("/tags", response_model=ListResponse[TagResponse])
async def list_tags(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    entity_type: str | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Tag).where(Tag.tenant_id == tenant_id)

    if search:
        base = base.where(Tag.name.ilike(f"%{search}%"))
    if entity_type:
        base = base.where(Tag.entity_type == entity_type)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Tag.name.asc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/tags", response_model=TagResponse, status_code=201)
async def create_tag(
    request: Request,
    body: TagCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    tag = Tag(
        tenant_id=tenant_id,
        **body.model_dump(),
    )
    db.add(tag)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="tag",
        entity_id=tag.id,
        summary=f"Created tag '{tag.name}'",
    )

    await db.refresh(tag)
    return tag


@router.get("/tags/{tag_id}", response_model=TagResponse)
async def get_tag(
    request: Request,
    tag_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.tenant_id == tenant_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.patch("/tags/{tag_id}", response_model=TagResponse)
async def update_tag(
    request: Request,
    tag_id: UUID,
    body: TagUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.tenant_id == tenant_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tag, field, value)
        changes[field] = str(value)

    tag.updated_at = datetime.now(timezone.utc) if hasattr(tag, 'updated_at') else None

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="tag",
        entity_id=tag.id,
        summary=f"Updated tag '{tag.name}'",
        changes=changes,
    )

    await db.flush()
    await db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(
    request: Request,
    tag_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.tenant_id == tenant_id)
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    name = tag.name
    await db.delete(tag)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="tag",
        entity_id=tag_id,
        summary=f"Deleted tag '{name}'",
    )

    return None


# ===========================================================================
# PROJECTS
# ===========================================================================


@router.get("/projects", response_model=ListResponse[ProjectResponse])
async def list_projects(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    company_id: UUID | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Project).where(Project.tenant_id == tenant_id).options(selectinload(Project.company))

    if search:
        base = base.where(Project.name.ilike(f"%{search}%"))
    if status:
        base = base.where(Project.status == status)
    if priority:
        base = base.where(Project.priority == priority)
    if company_id:
        base = base.where(Project.company_id == company_id)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Project.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()
    items = []
    for p in rows:
        item = p.__dict__.copy()
        if p.company:
            item['company'] = {'id': str(p.company.id), 'name': p.company.name}
        items.append(item)
    return ListResponse(items=items, total=total)


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    request: Request,
    body: ProjectCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)
    workspace_id = getattr(request.state, "workspace_id", None)

    project = Project(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        **body.model_dump(),
    )
    db.add(project)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="project",
        entity_id=project.id,
        summary=f"Created project '{project.name}'",
        workspace_id=workspace_id,
    )

    await db.refresh(project)
    result = await db.execute(
        select(Project).options(selectinload(Project.company)).where(Project.id == project.id)
    )
    project = result.scalar_one()
    item = project.__dict__.copy()
    if project.company:
        item['company'] = {'id': str(project.company.id), 'name': project.company.name}
    return item


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    request: Request,
    project_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id).options(selectinload(Project.company))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    item = project.__dict__.copy()
    if project.company:
        item['company'] = {'id': str(project.company.id), 'name': project.company.name}
    return item


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    request: Request,
    project_id: UUID,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    changes = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
        changes[field] = str(value)

    project.updated_at = datetime.now(timezone.utc)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="updated",
        entity_type="project",
        entity_id=project.id,
        summary=f"Updated project '{project.name}'",
        changes=changes,
    )

    await db.flush()
    await db.refresh(project)
    result = await db.execute(
        select(Project).options(selectinload(Project.company)).where(Project.id == project.id)
    )
    project = result.scalar_one()
    item = project.__dict__.copy()
    if project.company:
        item['company'] = {'id': str(project.company.id), 'name': project.company.name}
    return item


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    request: Request,
    project_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    name = project.name
    await db.delete(project)

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="deleted",
        entity_type="project",
        entity_id=project_id,
        summary=f"Deleted project '{name}'",
    )

    return None


# ===========================================================================
# Project Calendar Event CRUD
# ===========================================================================


@router.get("/calendar-events", response_model=list[ProjectCalendarEventResponse])
async def list_all_calendar_events(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = (
        select(ProjectCalendarEvent)
        .where(ProjectCalendarEvent.tenant_id == tenant_id)
        .order_by(ProjectCalendarEvent.start.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(base)
    return result.scalars().all()


@router.get("/projects/{project_id}/calendar-events", response_model=list[ProjectCalendarEventResponse])
async def list_calendar_events(
    request: Request,
    project_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(ProjectCalendarEvent).where(
            ProjectCalendarEvent.tenant_id == tenant_id,
            ProjectCalendarEvent.project_id == project_id,
        ).order_by(ProjectCalendarEvent.start)
    )
    rows = result.scalars().all()
    return list(rows)


@router.post("/projects/{project_id}/calendar-events", response_model=ProjectCalendarEventResponse, status_code=201)
async def create_calendar_event(
    request: Request,
    project_id: UUID,
    body: ProjectCalendarEventCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    obj = ProjectCalendarEvent(
        tenant_id=tenant_id,
        project_id=body.project_id,
        title=body.title,
        description=body.description,
        event_type=body.event_type or "milestone",
        start=body.start,
        end=body.end,
        is_all_day=body.is_all_day or False,
        color=body.color or "#00693E",
        location=body.location,
    )
    db.add(obj)
    await db.flush()
    await db.refresh(obj)

    await _log_activity(
        db, tenant_id=tenant_id, actor_id=user_id,
        action="created", entity_type="calendar_event", entity_id=obj.id,
        summary=f"Created calendar event '{obj.title}' for project",
    )
    return obj


@router.patch("/calendar-events/{event_id}", response_model=ProjectCalendarEventResponse)
async def update_calendar_event(
    request: Request,
    event_id: UUID,
    body: ProjectCalendarEventUpdate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(ProjectCalendarEvent).where(
            ProjectCalendarEvent.id == event_id,
            ProjectCalendarEvent.tenant_id == tenant_id,
        )
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Calendar event not found")

    for field in ("title", "description", "event_type", "start", "end", "is_all_day", "color", "location"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(obj, field, val)
    obj.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(obj)

    await _log_activity(
        db, tenant_id=tenant_id, actor_id=user_id,
        action="updated", entity_type="calendar_event", entity_id=obj.id,
        summary=f"Updated calendar event '{obj.title}'",
    )
    return obj


@router.delete("/calendar-events/{event_id}", status_code=204)
async def delete_calendar_event(
    request: Request,
    event_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    result = await db.execute(
        select(ProjectCalendarEvent).where(
            ProjectCalendarEvent.id == event_id,
            ProjectCalendarEvent.tenant_id == tenant_id,
        )
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Calendar event not found")

    title = obj.title
    await db.delete(obj)

    await _log_activity(
        db, tenant_id=tenant_id, actor_id=user_id,
        action="deleted", entity_type="calendar_event", entity_id=event_id,
        summary=f"Deleted calendar event '{title}'",
    )
    return None


# ===========================================================================
# Global CRM Search — unified search across all entities
# ===========================================================================


@router.get("/search")
async def global_crm_search(
    request: Request,
    q: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Search across all CRM entities (contacts, companies, deals, tasks,
    projects, touchpoints, notes) using a single UNION ALL query.

    Returns a flat result list with id, type, label, sub, url.
    """
    tenant_id = _get_tenant_id(request)
    pattern = f"%{q}%"

    # ── Main data query with UNION ALL ────────────────────────────────
    data_sql = text(
        """
        SELECT id, type, label, sub, url
        FROM (
            SELECT
                c.id::text                AS id,
                'contact'                 AS type,
                c.name                    AS label,
                COALESCE(c.email, '')     AS sub,
                '/contacts/' || c.id::text AS url
            FROM nexus_crm.contacts c
            WHERE c.tenant_id = :tenant_id
              AND (c.name       ILIKE :q
                OR c.email      ILIKE :q
                OR c.phone      ILIKE :q
                OR c.chinese_name ILIKE :q)

            UNION ALL

            SELECT
                co.id::text                 AS id,
                'company'                   AS type,
                co.name                     AS label,
                COALESCE(co.industry, '')   AS sub,
                '/companies/' || co.id::text AS url
            FROM nexus_crm.companies co
            WHERE co.tenant_id = :tenant_id
              AND (co.name     ILIKE :q
                OR co.domain   ILIKE :q
                OR co.industry ILIKE :q)

            UNION ALL

            SELECT
                d.id::text                AS id,
                'deal'                    AS type,
                d.name                    AS label,
                ''                        AS sub,
                '/deals/' || d.id::text   AS url
            FROM nexus_crm.deals d
            WHERE d.tenant_id = :tenant_id
              AND (d.name  ILIKE :q
                OR d.notes ILIKE :q)

            UNION ALL

            SELECT
                t.id::text               AS id,
                'task'                   AS type,
                t.title                  AS label,
                ''                       AS sub,
                '/tasks/' || t.id::text  AS url
            FROM nexus_crm.tasks t
            WHERE t.tenant_id = :tenant_id
              AND t.title ILIKE :q

            UNION ALL

            SELECT
                p.id::text                 AS id,
                'project'                  AS type,
                p.name                     AS label,
                ''                         AS sub,
                '/projects/' || p.id::text AS url
            FROM nexus_crm.projects p
            WHERE p.tenant_id = :tenant_id
              AND p.name ILIKE :q

            UNION ALL

            SELECT
                tp.id::text                   AS id,
                'touchpoint'                  AS type,
                tp.title                      AS label,
                ''                            AS sub,
                '/touchpoints/' || tp.id::text AS url
            FROM nexus_crm.touchpoints tp
            WHERE tp.tenant_id = :tenant_id
              AND tp.title ILIKE :q

            UNION ALL

            SELECT
                n.id::text               AS id,
                'note'                   AS type,
                COALESCE(n.title, '')    AS label,
                LEFT(COALESCE(n.content, ''), 200) AS sub,
                '/notes/' || n.id::text  AS url
            FROM nexus_crm.notes n
            WHERE n.tenant_id = :tenant_id
              AND (n.title   ILIKE :q
                OR n.content ILIKE :q)
        ) results
        LIMIT :limit
        """
    )

    # ── Count query (same filters, no data) ───────────────────────────
    count_sql = text(
        """
        SELECT COUNT(*) FROM (
            SELECT c.id FROM nexus_crm.contacts c
             WHERE c.tenant_id = :tenant_id
               AND (c.name ILIKE :q OR c.email ILIKE :q OR c.phone ILIKE :q OR c.chinese_name ILIKE :q)
            UNION ALL
            SELECT co.id FROM nexus_crm.companies co
             WHERE co.tenant_id = :tenant_id
               AND (co.name ILIKE :q OR co.domain ILIKE :q OR co.industry ILIKE :q)
            UNION ALL
            SELECT d.id FROM nexus_crm.deals d
             WHERE d.tenant_id = :tenant_id
               AND (d.name ILIKE :q OR d.notes ILIKE :q)
            UNION ALL
            SELECT t.id FROM nexus_crm.tasks t
             WHERE t.tenant_id = :tenant_id AND t.title ILIKE :q
            UNION ALL
            SELECT p.id FROM nexus_crm.projects p
             WHERE p.tenant_id = :tenant_id AND p.name ILIKE :q
            UNION ALL
            SELECT tp.id FROM nexus_crm.touchpoints tp
             WHERE tp.tenant_id = :tenant_id AND tp.title ILIKE :q
            UNION ALL
            SELECT n.id FROM nexus_crm.notes n
             WHERE n.tenant_id = :tenant_id
               AND (n.title ILIKE :q OR n.content ILIKE :q)
        ) cnt
        """
    )

    params = {"tenant_id": tenant_id, "q": pattern, "limit": limit}

    rows = (await db.execute(data_sql, params)).fetchall()
    total = (await db.execute(count_sql, params)).scalar() or 0

    results = [
        {
            "id": row.id,
            "type": row.type,
            "label": row.label,
            "sub": row.sub,
            "url": row.url,
        }
        for row in rows
    ]

    return {"results": results, "total": total}
