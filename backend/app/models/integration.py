"""Integration & OAuth State models — per-user, per-tenant isolation."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from app.db import Base


class Integration(Base):
    """Per-user integration connection record."""
    __tablename__ = "nexus_integrations"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("nexus_auth.nexus_auth_users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(100), nullable=False)              # 'google_calendar', 'slack', etc.
    provider_display = Column(String(255), nullable=False)      # 'Google Calendar'
    status = Column(String(50), default="disconnected")         # disconnected | connecting | active | error
    config = Column(JSON, default=dict)                         # {refresh_token, calendar_id, ...}
    metadata_ = Column("metadata", JSON, default=dict)          # {connected_at, last_error, user_email}
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class OAuthState(Base):
    """Temporary OAuth state — CSRF protection + user binding."""
    __tablename__ = "nexus_oauth_states"
    __table_args__ = {"schema": "nexus_crm"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    provider = Column(String(100), nullable=False)
    state = Column(String(255), unique=True, nullable=False, index=True)
    redirect_uri = Column(String(500), default="")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
