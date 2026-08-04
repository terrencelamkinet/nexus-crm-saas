"""AI Secretary Settings — per-user assistant preferences + channel credentials."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, SmallInteger, Text, DateTime, Time
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db import Base

DEFAULT_MODULES = ["weather", "today_tasks", "meetings", "project_status", "hot_leads", "stale_deals"]
DEFAULT_WORKDAYS = ["mon", "tue", "wed", "thu", "fri"]
DEFAULT_CHANNELS = {
    "whatsapp": {"connected": False, "enabled": False},
    "telegram": {"connected": False, "enabled": False},
    "email": {"connected": False, "enabled": False},
    "sms": {"connected": False, "enabled": False},
}
DEFAULT_GREETING_SLOTS = [
    {"key": "morning", "emoji": "🌅", "start": "05:00"},
    {"key": "afternoon", "emoji": "☀️", "start": "12:00"},
    {"key": "evening", "emoji": "🌆", "start": "18:00"},
    {"key": "lateNight", "emoji": "🌙", "start": "23:00"},
]

VALID_TONES = ("professional", "friendly", "direct", "encouraging", "formal")
VALID_LANGS = ("zh-HK", "zh-TW", "en")
VALID_CHANNELS = ("whatsapp", "telegram", "email", "sms")


class SecretarySettings(Base):
    """One row per user — replaces nexus-secretary-settings / nexus-working-hours / nexus-greeting-slots."""

    __tablename__ = "ai_secretary_settings"
    __table_args__ = {"schema": "nexus_ai"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    modules = Column(JSONB, default=lambda: list(DEFAULT_MODULES), nullable=False)
    workdays = Column(JSONB, default=lambda: list(DEFAULT_WORKDAYS), nullable=False)
    weekend_mute = Column(Boolean, default=True, nullable=False)
    strict_silence = Column(Boolean, default=True, nullable=False)
    tone = Column(String(20), default="professional", nullable=False)
    instructions = Column(Text, default="", nullable=False)
    lang_pref = Column(String(10), default="zh-HK", nullable=False)
    detail_level = Column(SmallInteger, default=2, nullable=False)
    channels = Column(JSONB, default=lambda: dict(DEFAULT_CHANNELS), nullable=False)

    work_start = Column(Time, default=lambda: _time("09:00"), nullable=False)
    work_end = Column(Time, default=lambda: _time("18:00"), nullable=False)
    greeting_slots = Column(JSONB, default=lambda: [dict(s) for s in DEFAULT_GREETING_SLOTS], nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class ChannelCredential(Base):
    """Per-user OAuth tokens for messaging channels (reserved; encrypted at app level)."""

    __tablename__ = "ai_channel_credentials"
    __table_args__ = {"schema": "nexus_ai"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    channel = Column(String(20), nullable=False)
    access_token = Column(Text, default="")
    refresh_token = Column(Text, default="")
    external_id = Column(String(255), default="")
    connected_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def _time(hhmm: str):
    h, m = hhmm.split(":")
    from datetime import time as dtime
    return dtime(int(h), int(m))
