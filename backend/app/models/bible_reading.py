"""Bible reading progress + static verses (BRIEFING-MODULES-DEEP-OPTIONS.md spec).

- BibleReadingProgress: per-user plan progress (RLS: tenant_id + user_id)
- BibleVerse: static scripture content per translation (public-domain seeds first)
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db import Base


class BibleReadingProgress(Base):
    __tablename__ = "bible_reading_progress"
    __table_args__ = {"schema": "nexus_ai"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    plan = Column(String(32), nullable=False)
    book_selection = Column(String(32), nullable=False)
    day_index = Column(Integer, default=0, nullable=False)
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_completed_at = Column(DateTime(timezone=True))


class BibleVerse(Base):
    __tablename__ = "bible_verses"
    __table_args__ = {"schema": "nexus_ai"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    translation = Column(String(16), nullable=False)
    reference = Column(String(32), nullable=False)
    book = Column(String(32), nullable=False)
    text = Column(Text, nullable=False)
