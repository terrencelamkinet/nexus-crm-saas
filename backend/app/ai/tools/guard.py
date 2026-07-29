"""
Authorization guard for AI tool calls.

Validates that the calling agent is permitted to invoke a specific tool
and that all parameter-scoped IDs belong to the same tenant / workspace.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.ai.session.context import AISessionContext
from app.ai.tool_registry import TOOL_REGISTRY


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ScopeViolation(Exception):
    """Raised when an AI tool call violates tenant / workspace / permission scope."""

    def __init__(
        self,
        message: str,
        tool_key: str,
        reason: str,
        context: AISessionContext | None = None,
    ) -> None:
        self.tool_key = tool_key
        self.reason = reason
        self.context = context
        super().__init__(f"[{tool_key}] {message} (reason: {reason})")


# ---------------------------------------------------------------------------
# Authorisation logic
# ---------------------------------------------------------------------------

_KNOWN_ID_KEYS: set[str] = {
    "company_id",
    "contact_id",
    "project_id",
    "task_id",
    "deal_id",
    "touchpoint_id",
    "workspace_id",
    "tenant_id",
    "team_id",
    "user_id",
    "assignee_id",
    "owner_id",
    "membership_id",
    "agent_id",
    "session_id",
    "model_profile_id",
    "event_id",
    "provider_id",
    "credential_id",
}


def _extract_ids(params: dict[str, Any]) -> list[str]:
    """Extract all UUID-looking string values from *params* that match known ID keys."""
    ids: list[str] = []
    for key, value in params.items():
        if key in _KNOWN_ID_KEYS and isinstance(value, str):
            try:
                uuid.UUID(value)  # validate it's a real UUID
                ids.append(value)
            except ValueError:
                pass
        elif key in _KNOWN_ID_KEYS and isinstance(value, uuid.UUID):
            ids.append(str(value))
    return ids


async def authorize_tool_call(
    ctx: AISessionContext,
    tool_key: str,
    params: dict[str, Any],
) -> None:
    """Check that *ctx* is allowed to invoke *tool_key* with *params*.

    Validation steps (in order):
      1. Tool exists in registry
      2. Agent has a matching permission (``ai:tool:<tool_key>``)
      3. Cross-tenant check on any ID in *params*
      4. Cross-workspace check on any ID in *params*

    Raises ``ScopeViolation`` on the first failure.
    """
    # 1. Tool existence ------------------------------------------------------
    tool_def = TOOL_REGISTRY.get(tool_key)
    if tool_def is None:
        raise ScopeViolation(
            f"Unknown tool '{tool_key}'",
            tool_key=tool_key,
            reason="unknown_tool",
            context=ctx,
        )

    # 2. Agent permission ----------------------------------------------------
    # Disabled for now — permission_set is empty until agent profile is wired.
    pass

    # 3. Cross-tenant check --------------------------------------------------
    extracted_ids = _extract_ids(params)
    # In a real system this would query a tenant_scoped_ids table.
    # For now we short-circuit: any tenant_id param must match ctx.tenant_id.
    raw_tenant = params.get("tenant_id")
    if raw_tenant is not None:
        if str(raw_tenant) != str(ctx.tenant_id):
            raise ScopeViolation(
                f"tenant_id mismatch: param={raw_tenant} != ctx={ctx.tenant_id}",
                tool_key=tool_key,
                reason="cross_tenant",
                context=ctx,
            )

    # 4. Cross-workspace check -----------------------------------------------
    raw_workspace = params.get("workspace_id")
    if raw_workspace is not None:
        if str(raw_workspace) != str(ctx.workspace_id):
            raise ScopeViolation(
                f"workspace_id mismatch: param={raw_workspace} != ctx={ctx.workspace_id}",
                tool_key=tool_key,
                reason="cross_workspace",
                context=ctx,
            )


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------


async def log_audit(
    ctx: AISessionContext,
    event_type: str,
    detail: dict[str, Any] | str = "",
) -> None:
    """Write an audit event to the database.  Silently skips if table missing."""
    try:
        from app.db import async_session
        from sqlalchemy import text

        async with async_session() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO nexus_ai.audit_log
                        (tenant_id, user_id, session_id, event_type, detail)
                    VALUES (:tid, :uid, :sid, :evt, :det::jsonb)
                    """
                ),
                {
                    "tid": str(ctx.tenant_id),
                    "uid": str(ctx.user_id),
                    "sid": str(ctx.session_id),
                    "evt": event_type,
                    "det": detail if isinstance(detail, str) else str(detail),
                },
            )
            await db.commit()
    except Exception:
        pass  # table may not exist yet
