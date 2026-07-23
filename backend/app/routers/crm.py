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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import ColumnProperty

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
)
from app.models.crm_module_b import Deal, DealStage
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
) -> None:
    entry = ActivityLog(
        tenant_id=tenant_id,
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

    company = Company(
        tenant_id=tenant_id,
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

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    sort_col = getattr(Contact, sort_by, None)
    if sort_col is None or not isinstance(sort_col.property, ColumnProperty):
        sort_col = Contact.created_at
    order = sort_col.asc() if sort_order == "asc" else sort_col.desc()
    items_q = base.order_by(order).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/contacts", response_model=ContactResponse, status_code=201)
async def create_contact(
    request: Request,
    body: ContactCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    contact = Contact(
        tenant_id=tenant_id,
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
    )

    await db.refresh(contact)
    return contact


@router.get("/contacts/{contact_id}", response_model=ContactResponse)
async def get_contact(
    request: Request,
    contact_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.tenant_id == tenant_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


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
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Touchpoint).where(Touchpoint.tenant_id == tenant_id)

    if search:
        base = base.where(Touchpoint.title.ilike(f"%{search}%"))

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Touchpoint.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/touchpoints", response_model=TouchpointResponse, status_code=201)
async def create_touchpoint(
    request: Request,
    body: TouchpointCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    touchpoint = Touchpoint(
        tenant_id=tenant_id,
        created_by=user_id,
        **body.model_dump(),
    )
    db.add(touchpoint)
    await db.flush()

    await _log_activity(
        db,
        tenant_id=tenant_id,
        actor_id=user_id,
        action="created",
        entity_type="touchpoint",
        entity_id=touchpoint.id,
        summary=f"Created touchpoint '{touchpoint.title}'",
    )

    await db.refresh(touchpoint)
    return touchpoint


@router.get("/touchpoints/{touchpoint_id}", response_model=TouchpointResponse)
async def get_touchpoint(
    request: Request,
    touchpoint_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Touchpoint).where(
            Touchpoint.id == touchpoint_id, Touchpoint.tenant_id == tenant_id
        )
    )
    touchpoint = result.scalar_one_or_none()
    if not touchpoint:
        raise HTTPException(status_code=404, detail="Touchpoint not found")
    return touchpoint


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
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(touchpoint, field, value)
        changes[field] = str(value)

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
    await db.refresh(touchpoint)
    return touchpoint


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
    priority: str | None = None,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    base = select(Task).where(Task.tenant_id == tenant_id)

    if search:
        base = base.where(Task.title.ilike(f"%{search}%"))
    if status:
        base = base.where(Task.status == status)
    if priority:
        base = base.where(Task.priority == priority)

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Task.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def create_task(
    request: Request,
    body: TaskCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    task = Task(
        tenant_id=tenant_id,
        created_by=user_id,
        **body.model_dump(),
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
    )

    await db.refresh(task)
    return task


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(
    request: Request,
    task_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.tenant_id == tenant_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


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
    for field, value in body.model_dump(exclude_unset=True).items():
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

    await db.flush()
    await db.refresh(task)
    return task


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


# ===========================================================================
# NOTES
# ===========================================================================


@router.get("/notes", response_model=ListResponse[NoteResponse])
async def list_notes(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
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

    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    items_q = base.order_by(Note.created_at.desc()).offset(offset).limit(limit)
    rows = (await db.execute(items_q)).scalars().all()

    return ListResponse(items=list(rows), total=total)


@router.post("/notes", response_model=NoteResponse, status_code=201)
async def create_note(
    request: Request,
    body: NoteCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    note = Note(
        tenant_id=tenant_id,
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
        select(Note).where(Note.id == note_id, Note.tenant_id == tenant_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


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

    entry = ActivityLog(
        tenant_id=tenant_id,
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
    base = select(Project).where(Project.tenant_id == tenant_id)

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

    return ListResponse(items=list(rows), total=total)


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    request: Request,
    body: ProjectCreate,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    user_id = _get_user_id(request)

    project = Project(
        tenant_id=tenant_id,
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
    )

    await db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    request: Request,
    project_id: UUID,
    db: AsyncSession = Depends(get_tenant_session),
):
    tenant_id = _get_tenant_id(request)
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


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
    return project


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
