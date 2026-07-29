"""
AI Session Context — request-scoped metadata carriers.

No LLM provider imports here; this module stays pure Python + stdlib.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


@dataclass(frozen=True)
class AISessionContext:
    """Immutable snapshot of all tenant/session metadata for a single AI request."""

    session_id: uuid.UUID
    tenant_id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    membership_id: uuid.UUID
    team_id: Optional[uuid.UUID] = None
    role_ids: list[uuid.UUID] = field(default_factory=list)
    permission_set: frozenset[str] = field(default_factory=frozenset)
    agent_id: Optional[uuid.UUID] = None
    model_profile_id: Optional[uuid.UUID] = None
    plan_type: str = "chat"
    request_id: str = ""


async def build_ai_session_context(
    request: Request,
    db: AsyncSession,
) -> AISessionContext:
    """Build an AISessionContext from the current request and DB session.

    Reads tenant_id / user_id from *request.state* (set by an earlier
    auth middleware).  Resolves workspace_id from a fast Redis lookup if
    available, otherwise falls back to a DB query.
    """
    tenant_id: uuid.UUID = request.state.tenant_id
    user_id: uuid.UUID = request.state.user_id

    # --- resolve workspace_id ------------------------------------------------
    workspace_id: Optional[uuid.UUID] = getattr(request.state, "workspace_id", None)
    if workspace_id is None:
        # Fallback: query the DB for the user's default/current workspace
        row = await db.execute(
            text(
                """
                SELECT workspace_id FROM workspace_members
                WHERE user_id = :uid AND tenant_id = :tid
                ORDER BY is_default DESC NULLS LAST
                LIMIT 1
                """
            ),
            {"uid": user_id, "tid": tenant_id},
        )
        result = row.scalar_one_or_none()
        if result is not None:
            workspace_id = uuid.UUID(str(result))
        else:
            workspace_id = uuid.UUID(int=0)  # sentinel — no workspace

    # --- resolve optional fields ---------------------------------------------
    team_id: Optional[uuid.UUID] = getattr(request.state, "team_id", None)
    membership_id: uuid.UUID = getattr(request.state, "membership_id", uuid.UUID(int=0))
    role_ids: list[uuid.UUID] = getattr(request.state, "role_ids", [])
    permission_set: frozenset[str] = getattr(
        request.state, "permission_set", frozenset()
    )
    agent_id: Optional[uuid.UUID] = getattr(request.state, "agent_id", None)
    model_profile_id: Optional[uuid.UUID] = getattr(
        request.state, "model_profile_id", None
    )
    plan_type: str = getattr(request.state, "plan_type", "chat")
    request_id: str = getattr(request.state, "request_id", "")

    # session_id — use an existing one from the route param or generate a new one
    session_id: uuid.UUID = getattr(request.state, "session_id", uuid.uuid4())

    return AISessionContext(
        session_id=session_id,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        team_id=team_id,
        user_id=user_id,
        membership_id=membership_id,
        role_ids=role_ids,
        permission_set=permission_set,
        agent_id=agent_id,
        model_profile_id=model_profile_id,
        plan_type=plan_type,
        request_id=request_id,
    )
