"""
Tool registry — canonical catalog of all AI-callable tools.

Every tool that the AI layer can invoke must be registered in TOOL_REGISTRY.
Handlers are async placeholder functions that raise NotImplementedError until
the concrete CRM service module wires them in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolDef:
    """Definition of a single tool the AI agent can call."""

    key: str
    type: str  # "read" | "write"
    module: str  # dotted module path, e.g. "app.services.crm.companies"
    requires_confirmation: bool = False
    handler: Callable[..., Coroutine[Any, Any, Any]] | None = None
    input_schema: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Placeholder handlers
# ---------------------------------------------------------------------------


async def _not_implemented_handler(**kwargs: Any) -> Any:
    raise NotImplementedError(
        f"Handler for this tool has not been wired in yet. "
        f"Received kwargs: {kwargs}"
    )


def _placeholder() -> Callable[..., Coroutine[Any, Any, Any]]:
    return _not_implemented_handler


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, ToolDef] = {
    # fmt: off
    # ---- 10 READ tools -----------------------------------------------------
    "search_companies": ToolDef(
        key="search_companies",
        type="read",
        module="app.services.crm.companies",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term for company name or domain"},
                "limit": {"type": "integer", "default": 20},
            },
        },
        handler=_placeholder(),
    ),
    "get_company_detail": ToolDef(
        key="get_company_detail",
        type="read",
        module="app.services.crm.companies",
        input_schema={
            "type": "object",
            "properties": {
                "company_id": {"type": "string", "format": "uuid", "description": "Company UUID"},
            },
            "required": ["company_id"],
        },
        handler=_placeholder(),
    ),
    "search_contacts": ToolDef(
        key="search_contacts",
        type="read",
        module="app.services.crm.contacts",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term for name, email or phone"},
                "company_id": {"type": "string", "format": "uuid", "description": "Optional company filter"},
                "limit": {"type": "integer", "default": 20},
            },
        },
        handler=_placeholder(),
    ),
    "get_contact_detail": ToolDef(
        key="get_contact_detail",
        type="read",
        module="app.services.crm.contacts",
        input_schema={
            "type": "object",
            "properties": {
                "contact_id": {"type": "string", "format": "uuid", "description": "Contact UUID"},
            },
            "required": ["contact_id"],
        },
        handler=_placeholder(),
    ),
    "search_projects": ToolDef(
        key="search_projects",
        type="read",
        module="app.services.crm.projects",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term for project name or code"},
                "status": {"type": "string", "description": "Filter by status"},
                "limit": {"type": "integer", "default": 20},
            },
        },
        handler=_placeholder(),
    ),
    "list_tasks": ToolDef(
        key="list_tasks",
        type="read",
        module="app.services.crm.tasks",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "format": "uuid", "description": "Optional project filter"},
                "assignee_id": {"type": "string", "format": "uuid", "description": "Optional assignee filter"},
                "status": {"type": "string", "description": "Filter by status"},
                "limit": {"type": "integer", "default": 50},
            },
        },
        handler=_placeholder(),
    ),
    "list_touchpoints": ToolDef(
        key="list_touchpoints",
        type="read",
        module="app.services.crm.touchpoints",
        input_schema={
            "type": "object",
            "properties": {
                "company_id": {"type": "string", "format": "uuid", "description": "Optional company filter"},
                "contact_id": {"type": "string", "format": "uuid", "description": "Optional contact filter"},
                "limit": {"type": "integer", "default": 50},
            },
        },
        handler=_placeholder(),
    ),
    "get_dashboard_summary": ToolDef(
        key="get_dashboard_summary",
        type="read",
        module="app.services.crm.dashboard",
        input_schema={
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["7d", "30d", "90d"], "default": "30d"},
            },
        },
        handler=_placeholder(),
    ),
    "search_deals": ToolDef(
        key="search_deals",
        type="read",
        module="app.services.crm.deals",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search term for deal name or description"},
                "stage": {"type": "string", "description": "Filter by pipeline stage"},
                "limit": {"type": "integer", "default": 20},
            },
        },
        handler=_placeholder(),
    ),
    "get_upcoming_events": ToolDef(
        key="get_upcoming_events",
        type="read",
        module="app.services.crm.events",
        input_schema={
            "type": "object",
            "properties": {
                "days_ahead": {"type": "integer", "default": 30, "description": "How many days to look ahead"},
                "limit": {"type": "integer", "default": 20},
            },
        },
        handler=_placeholder(),
    ),
    # ---- 3 WRITE tools (all require confirmation) --------------------------
    "create_task_draft": ToolDef(
        key="create_task_draft",
        type="write",
        module="app.services.crm.tasks",
        requires_confirmation=True,
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Task title"},
                "description": {"type": "string", "description": "Task description"},
                "assignee_id": {"type": "string", "format": "uuid", "description": "Assignee user UUID"},
                "due_date": {"type": "string", "format": "date", "description": "Due date YYYY-MM-DD"},
                "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
            },
            "required": ["title"],
        },
        handler=_placeholder(),
    ),
    "create_touchpoint_draft": ToolDef(
        key="create_touchpoint_draft",
        type="write",
        module="app.services.crm.touchpoints",
        requires_confirmation=True,
        input_schema={
            "type": "object",
            "properties": {
                "company_id": {"type": "string", "format": "uuid", "description": "Company UUID"},
                "contact_id": {"type": "string", "format": "uuid", "description": "Contact UUID"},
                "type": {"type": "string", "enum": ["call", "email", "meeting", "note", "other"]},
                "summary": {"type": "string", "description": "Touchpoint summary"},
                "occurred_at": {"type": "string", "format": "date-time", "description": "ISO 8601 timestamp"},
            },
            "required": ["type", "summary"],
        },
        handler=_placeholder(),
    ),
    "update_contact_draft": ToolDef(
        key="update_contact_draft",
        type="write",
        module="app.services.crm.contacts",
        requires_confirmation=True,
        input_schema={
            "type": "object",
            "properties": {
                "contact_id": {"type": "string", "format": "uuid", "description": "Contact UUID to update"},
                "name": {"type": "string", "description": "Updated name"},
                "email": {"type": "string", "format": "email", "description": "Updated email"},
                "phone": {"type": "string", "description": "Updated phone number"},
                "notes": {"type": "string", "description": "Additional notes"},
            },
            "required": ["contact_id"],
        },
        handler=_placeholder(),
    ),
    # fmt: on
}
