from pydantic import BaseModel, ConfigDict
from typing import Optional, Any
from uuid import UUID
from datetime import datetime, date
from typing import Generic, TypeVar

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Generic paginated response
# ---------------------------------------------------------------------------

class ListResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int


# ===========================================================================
# Company
# ===========================================================================

class CompanyCreate(BaseModel):
    name: str
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    category: Optional[str] = None
    ceo_name: Optional[str] = None
    linkedin_url: Optional[str] = None
    status: Optional[str] = None
    owner_id: Optional[UUID] = None


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    category: Optional[str] = None
    ceo_name: Optional[str] = None
    linkedin_url: Optional[str] = None
    status: Optional[str] = None
    owner_id: Optional[UUID] = None


class CompanyResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    domain: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    category: Optional[str] = None
    ceo_name: Optional[str] = None
    linkedin_url: Optional[str] = None
    status: Optional[str] = None
    owner_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ===========================================================================


# ===========================================================================
# Contact
# ===========================================================================

class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company_id: Optional[UUID] = None
    job_title: Optional[str] = None
    department: Optional[str] = None
    linkedin_url: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    avatar_url: Optional[str] = None
    custom_fields: Optional[dict[str, Any]] = None
    chinese_name: Optional[str] = None
    nick_name: Optional[str] = None
    contact_type: Optional[str] = None
    grade: Optional[str] = None
    numbers: list[str] = []
    office_phone: Optional[str] = None
    namecard_path: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    owner_id: Optional[UUID] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company_id: Optional[UUID] = None
    job_title: Optional[str] = None
    department: Optional[str] = None
    linkedin_url: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    avatar_url: Optional[str] = None
    custom_fields: Optional[dict[str, Any]] = None
    chinese_name: Optional[str] = None
    nick_name: Optional[str] = None
    contact_type: Optional[str] = None
    grade: Optional[str] = None
    numbers: Optional[list[str]] = None
    office_phone: Optional[str] = None
    namecard_path: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    owner_id: Optional[UUID] = None


class ContactResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company_id: Optional[UUID] = None
    company: Any = None
    job_title: Optional[str] = None
    chinese_name: Optional[str] = None
    nick_name: Optional[str] = None
    contact_type: Optional[str] = None
    grade: Optional[str] = None
    numbers: Optional[list[str]] = None
    office_phone: Optional[str] = None
    namecard_path: Optional[str] = None
    department: Optional[str] = None
    linkedin_url: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list[str]] = None
    avatar_url: Optional[str] = None
    custom_fields: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    source: Optional[str] = None
    owner_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Touchpoint
# ===========================================================================

class TouchpointCreate(BaseModel):
    type: str
    title: str
    description: Optional[str] = None
    date: Optional[datetime] = None  # will be set server-side if omitted
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    duration_minutes: Optional[int] = None


class TouchpointUpdate(BaseModel):
    type: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[datetime] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    duration_minutes: Optional[int] = None


class TouchpointResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    type: str
    title: str
    description: Optional[str] = None
    date: datetime
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    company: Any = None
    duration_minutes: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ===========================================================================


# ===========================================================================
# Task
# ===========================================================================

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[date] = None
    priority: str = "medium"
    status: str = "pending"
    assignee_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None


class TaskResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    title: str
    description: Optional[str] = None
    due_date: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    company: Any = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ===========================================================================


# ===========================================================================
# NameCard
# ===========================================================================

class NameCardCreate(BaseModel):
    image_url: Optional[str] = None
    raw_ocr_text: Optional[str] = None
    parsed_data: Optional[dict[str, Any]] = None
    status: str = "pending"
    contact_id: Optional[UUID] = None


class NameCardUpdate(BaseModel):
    image_url: Optional[str] = None
    raw_ocr_text: Optional[str] = None
    parsed_data: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    contact_id: Optional[UUID] = None


class NameCardResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    image_url: Optional[str] = None
    raw_ocr_text: Optional[str] = None
    parsed_data: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    contact_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ===========================================================================


# ===========================================================================
# Note
# ===========================================================================

class NoteCreate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: bool = False
    tags: list[str] = []
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: Optional[bool] = None
    tags: Optional[list[str]] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None


class NoteResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: bool = False
    tags: Optional[list[str]] = None
    contact_id: Optional[UUID] = None
    company_id: Optional[UUID] = None
    company: Any = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ===========================================================================


# ===========================================================================
# ActivityLog  (CREATE only — no Update)
# ===========================================================================

class ActivityLogCreate(BaseModel):
    action: str
    entity_type: str
    entity_id: UUID
    summary: Optional[str] = None
    changes: Optional[dict[str, Any]] = None


class ActivityLogResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    action: str
    entity_type: str
    entity_id: UUID
    summary: Optional[str] = None
    changes: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Tag
# ===========================================================================

class TagCreate(BaseModel):
    name: str
    color: Optional[str] = None
    entity_type: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    entity_type: Optional[str] = None


class TagResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    color: Optional[str] = None
    entity_type: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# ContactProject (contact <-> deal junction)
# ===========================================================================

class ContactProjectCreate(BaseModel):
    contact_id: UUID
    project_id: UUID
    role: Optional[str] = None


class ContactProjectResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    contact_id: UUID
    project_id: UUID
    role: Optional[str] = None
    created_at: datetime
    project_name: Optional[str] = None
    amount: Optional[float] = None
    stage_name: Optional[str] = None
    probability: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Project
# ===========================================================================


class ProjectCreate(BaseModel):
    name: str
    project_code: Optional[str] = None
    company_id: UUID
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    deal_id: Optional[UUID] = None
    stage_id: Optional[UUID] = None
    budget_amount: Optional[float] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    end_date: Optional[datetime] = None
    project_manager_id: Optional[UUID] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    project_code: Optional[str] = None
    company_id: Optional[UUID] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    deal_id: Optional[UUID] = None
    stage_id: Optional[UUID] = None
    budget_amount: Optional[float] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    end_date: Optional[datetime] = None
    project_manager_id: Optional[UUID] = None


class ProjectResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    project_code: str
    name: str
    company_id: UUID
    deal_id: Optional[UUID] = None
    stage_id: Optional[UUID] = None
    stage_updated_at: Optional[datetime] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    budget_amount: Optional[float] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    end_date: Optional[datetime] = None
    project_manager_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Project Calendar Event
# ===========================================================================


class ProjectCalendarEventCreate(BaseModel):
    project_id: UUID
    title: str
    description: Optional[str] = None
    event_type: Optional[str] = "milestone"
    start: datetime
    end: datetime
    is_all_day: Optional[bool] = False
    color: Optional[str] = "#00693E"
    location: Optional[str] = None


class ProjectCalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    is_all_day: Optional[bool] = None
    color: Optional[str] = None
    location: Optional[str] = None


class ProjectCalendarEventResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    title: str
    description: Optional[str] = None
    event_type: Optional[str] = None
    start: datetime
    end: datetime
    is_all_day: Optional[bool] = False
    color: Optional[str] = None
    location: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
