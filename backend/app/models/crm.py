import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, Integer, Date, Numeric, JSON, ARRAY
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db import Base


class Company(Base):
    __tablename__ = "companies"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    domain = Column(Text)
    industry = Column(Text)
    size = Column(Text)  # 1-10, 11-50, 51-200, 201-1000, 1000+
    phone = Column(Text)
    address = Column(Text)
    website = Column(Text)
    notes = Column(Text)
    tags = Column(ARRAY(Text), default=lambda: [])
    owner_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    custom_fields = Column(JSON, default=lambda: {})
    category = Column(String(50))
    ceo_name = Column(String(255))
    linkedin_url = Column(String(255))
    status = Column(String(50), default='ACTIVE')
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    contacts = relationship("Contact", back_populates="company")
    touchpoints = relationship("Touchpoint", back_populates="company")
    tasks = relationship("Task", back_populates="company")
    notes_rel = relationship("Note", back_populates="company")


class Contact(Base):
    __tablename__ = "contacts"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.companies.id", ondelete="SET NULL"))
    name = Column(Text, nullable=False)
    chinese_name = Column(Text)
    nick_name = Column(Text)
    email = Column(Text)
    phone = Column(Text)
    office_phone = Column(Text)
    numbers = Column(ARRAY(Text), default=lambda: [])
    job_title = Column(Text)
    department = Column(Text)
    linkedin_url = Column(Text)
    avatar_url = Column(Text)
    address = Column(Text)
    notes = Column(Text)
    tags = Column(ARRAY(Text), default=lambda: [])
    contact_type = Column(Text)
    grade = Column(Text)
    source = Column(Text)  # referral, linkedin, event, cold_outbound, namecard, other
    status = Column(Text, default="lead")  # lead, prospect, customer, churned, other
    owner_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    custom_fields = Column(JSON, default=lambda: {})
    namecard_path = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="contacts")
    touchpoints = relationship("Touchpoint", back_populates="contact")
    touchpoints_as_participant = relationship("Touchpoint", secondary="nexus_crm.touchpoint_participants", back_populates="participants", lazy="selectin", viewonly=True)
    tasks = relationship("Task", back_populates="contact")
    notes_rel = relationship("Note", back_populates="contact")
    name_cards = relationship("NameCard", back_populates="contact")
    contact_projects = relationship("ContactProject", back_populates="contact", cascade="all, delete-orphan")


class TouchpointParticipant(Base):
    __tablename__ = "touchpoint_participants"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    touchpoint_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.touchpoints.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="CASCADE"), nullable=False)


class Touchpoint(Base):
    __tablename__ = "touchpoints"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="SET NULL"))
    company_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.companies.id", ondelete="SET NULL"))
    type = Column(Text, nullable=False)  # meeting, call, email, note, social, lunch, other
    title = Column(Text, nullable=False)
    description = Column(Text)
    date = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    duration_minutes = Column(Integer)
    location = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    contact = relationship("Contact", back_populates="touchpoints")
    participants = relationship("Contact", secondary="nexus_crm.touchpoint_participants", back_populates="touchpoints", lazy="selectin")
    company = relationship("Company", back_populates="touchpoints")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text)
    due_date = Column(Date)
    priority = Column(Text, default="medium")  # low, medium, high, urgent
    status = Column(Text, default="pending")  # pending, in_progress, done, cancelled
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="SET NULL"))
    company_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.companies.id", ondelete="SET NULL"))
    deal_id = Column(UUID(as_uuid=True))  # NULL for Module A, filled by Module B
    parent_task_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.tasks.id", ondelete="SET NULL"))
    recurring = Column(Boolean, default=False)
    area = Column(Text)
    created_by = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # --- MS To Do fields ---
    list_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.task_lists.id", ondelete="SET NULL"))
    is_important = Column(Boolean, default=False)
    my_day_date = Column(Date)
    reminder_at = Column(DateTime(timezone=True))
    recurrence_rule = Column(Text)  # RRULE string
    notes_html = Column(Text)

    parent = relationship("Task", remote_side="Task.id", backref="subtasks")
    contact = relationship("Contact", back_populates="tasks")
    company = relationship("Company", back_populates="tasks")
    task_list = relationship("TaskList", back_populates="tasks")
    steps = relationship("TaskStep", back_populates="task", cascade="all, delete-orphan", order_by="TaskStep.sort_order")
    categories = relationship("TaskCategory", secondary="nexus_crm.task_category_map", back_populates="tasks", lazy="selectin")
    attachments = relationship("TaskAttachment", back_populates="task", cascade="all, delete-orphan")


class TaskList(Base):
    __tablename__ = "task_lists"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    color = Column(Text)
    icon = Column(Text)
    sort_order = Column(Integer, default=0)
    is_smart = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    tasks = relationship("Task", back_populates="task_list")
    shares = relationship("ListShare", back_populates="task_list", cascade="all, delete-orphan")


class TaskStep(Base):
    __tablename__ = "task_steps"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.tasks.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    is_completed = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("Task", back_populates="steps")


class TaskCategory(Base):
    __tablename__ = "task_categories"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    color = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tasks = relationship("Task", secondary="nexus_crm.task_category_map", back_populates="categories", lazy="selectin")


class TaskCategoryMap(Base):
    __tablename__ = "task_category_map"
    __table_args__ = {"schema": "nexus_crm"}

    task_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.tasks.id", ondelete="CASCADE"), primary_key=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.task_categories.id", ondelete="CASCADE"), primary_key=True)


class TaskAttachment(Base):
    __tablename__ = "task_attachments"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.tasks.id", ondelete="CASCADE"), nullable=False)
    filename = Column(Text, nullable=False)
    file_size = Column(Integer)
    content_type = Column(Text)
    storage_path = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("Task", back_populates="attachments")


class ListShare(Base):
    __tablename__ = "list_shares"
    __table_args__ = {"schema": "nexus_crm"}

    list_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.task_lists.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="CASCADE"), primary_key=True)
    permission = Column(Text, default="read")  # read, write
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task_list = relationship("TaskList", back_populates="shares")


class NameCard(Base):
    __tablename__ = "name_cards"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="SET NULL"))
    image_url = Column(Text)
    raw_ocr_text = Column(Text)
    parsed_data = Column(JSON, default=lambda: {})
    status = Column(Text, default="pending")  # pending, matched, created, ignored
    scanned_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    matched_by = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    contact = relationship("Contact", back_populates="name_cards")


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text)
    content = Column(Text)
    pinned = Column(Boolean, default=False)
    tags = Column(ARRAY(Text), default=lambda: [])
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="SET NULL"))
    company_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.companies.id", ondelete="SET NULL"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    contact = relationship("Contact", back_populates="notes_rel")
    company = relationship("Company", back_populates="notes_rel")


class ActivityLog(Base):
    __tablename__ = "activity_log"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    action = Column(Text, nullable=False)  # created, updated, deleted, restored
    entity_type = Column(Text, nullable=False)  # contact, company, touchpoint, task, name_card, note, deal, quote
    entity_id = Column(UUID(as_uuid=True))
    summary = Column(Text)
    changes = Column(JSON)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    color = Column(Text)
    entity_type = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ContactProject(Base):
    __tablename__ = "contact_projects"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.projects.id", ondelete="CASCADE"), nullable=False)
    role = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    contact = relationship("Contact", back_populates="contact_projects")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    project_code = Column(String(100), nullable=False, default=lambda: f"PRJ-{uuid.uuid4().hex[:8].upper()}")
    name = Column(Text, nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.companies.id", ondelete="SET NULL"), nullable=False)
    deal_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.deals.id", ondelete="SET NULL"))
    stage_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.project_stages.id", ondelete="SET NULL"))
    stage_updated_at = Column(DateTime(timezone=True))
    status = Column(String(50), default="planning")
    priority = Column(String(50), default="medium")
    description = Column(Text)
    budget_amount = Column(Numeric)
    start_date = Column(DateTime(timezone=True))
    deadline = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    project_manager_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    sales_owner_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="SET NULL"))
    incharge_client_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.contacts.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    company = relationship("Company", foreign_keys=[company_id])


class ProjectCalendarEvent(Base):
    __tablename__ = "project_calendar_events"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("nexus_crm.projects.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text)
    event_type = Column(String(50), default="milestone")  # milestone, task, meeting, reminder
    start = Column(DateTime(timezone=True), nullable=False)
    end = Column(DateTime(timezone=True), nullable=False)
    is_all_day = Column(Boolean, default=False)
    color = Column(String(20), default="#00693E")
    location = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    project = relationship("Project")
