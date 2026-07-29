"""AI Module Router — /api/v1/ai/* endpoints

Draft → Confirm → Execute flow for AI tools.
Provider-agnostic: no LLM imports, pure REST.

Default provider: DeepSeek (deepseek-chat).
"""

from uuid import UUID
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_tenant_session
from app.ai.tool_registry import TOOL_REGISTRY, ToolDef
from app.ai.tools.guard import authorize_tool_call, ScopeViolation, log_audit
from app.ai.providers import get_provider, ProviderAdapter
from app.models.ai import ActionRequest

# ---------------------------------------------------------------------------
# Default provider configuration
# ---------------------------------------------------------------------------
DEFAULT_PROVIDER: str = "deepseek"
DEFAULT_MODEL: str = "deepseek-chat"


def _default_adapter() -> ProviderAdapter:
    """Build the default LLM provider adapter (DeepSeek)."""
    return get_provider(DEFAULT_PROVIDER, default_model=DEFAULT_MODEL)


router = APIRouter(prefix="/api/v1/ai", tags=["AI"])


# ====================================================================
# Tool execution
# ====================================================================

@router.post("/tools/{tool_key}/execute")
async def execute_tool(
    tool_key: str,
    params: dict,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    tool = TOOL_REGISTRY.get(tool_key)
    if not tool:
        raise HTTPException(404, f"Tool '{tool_key}' not found")

    try:
        await authorize_tool_call(ctx, tool_key, params)
    except ScopeViolation as e:
        try:
            await log_audit(ctx, "access_denied", {"tool_key": tool_key, "reason": str(e)})
        except Exception:
            pass  # audit_log table may not exist
        raise HTTPException(403, str(e))

    if tool.type == "read":
        result = await tool.handler(ctx, params, db)
        return {"result": result}

    elif tool.type == "write" and tool.requires_confirmation:
        preview = await tool.handler(ctx, params, db, mode="draft")
        action = ActionRequest(
            tenant_id=ctx.tenant_id,
            workspace_id=ctx.workspace_id,
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            tool_key=tool_key,
            target_module=tool.module,
            payload_preview=preview,
            status="pending",
        )
        db.add(action)
        await db.flush()
        return {"action_id": str(action.id), "preview": preview}

    raise HTTPException(400, f"Unsupported tool type: {tool.type}")


# ====================================================================
# Action confirmation
# ====================================================================

@router.post("/actions/{action_id}/confirm")
async def confirm_action(
    action_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    result = await db.execute(
        select(ActionRequest).where(
            ActionRequest.id == action_id,
            ActionRequest.user_id == ctx.user_id,
        )
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(404, "Action request not found")
    if action.status != "pending":
        raise HTTPException(400, f"Action already {action.status}")

    tool = TOOL_REGISTRY.get(action.tool_key)
    if not tool:
        raise HTTPException(404, f"Tool '{action.tool_key}' not found")

    try:
        await authorize_tool_call(ctx, action.tool_key, action.payload_preview)
    except ScopeViolation as e:
        action.status = "rejected"
        await log_audit(ctx, "access_denied", {"action_id": str(action_id), "reason": str(e)})
        await db.flush()
        raise HTTPException(403, str(e))

    result_data = await tool.handler(ctx, action.payload_preview, db, mode="execute")
    action.status = "executed"
    action.executed_at = datetime.now(timezone.utc)
    action.result = result_data

    await log_audit(ctx, "action_executed", {
        "action_id": str(action_id),
        "tool_key": action.tool_key,
    })
    return {"status": "executed", "result": result_data}


# ====================================================================
# Action rejection
# ====================================================================

@router.post("/actions/{action_id}/reject")
async def reject_action(
    action_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    result = await db.execute(
        select(ActionRequest).where(
            ActionRequest.id == action_id,
            ActionRequest.user_id == ctx.user_id,
            ActionRequest.status == "pending",
        )
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(404, "Pending action not found")

    action.status = "rejected"
    return {"status": "rejected"}


# ====================================================================
# Health
# ====================================================================

@router.get("/health")
async def ai_health():
    return {
        "status": "ok",
        "tools_registered": len(TOOL_REGISTRY),
        "read_tools": sum(1 for t in TOOL_REGISTRY.values() if t.type == "read"),
        "write_tools": sum(1 for t in TOOL_REGISTRY.values() if t.type == "write"),
        "default_provider": DEFAULT_PROVIDER,
        "default_model": DEFAULT_MODEL,
    }


# ====================================================================
# Chat completion (proxy to LLM provider)
# ====================================================================


@router.post("/chat")
async def chat_completion(
    messages: list[dict[str, Any]],
    request: Request,
    model: str = DEFAULT_MODEL,
    provider: str = DEFAULT_PROVIDER,
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """Send a chat completion request to the default LLM provider (DeepSeek).

    Uses DeepSeek by default. Override via ``provider`` and ``model`` params.
    The provider is used to enrich tool context but does **not** drive tool
    execution itself — that is handled by the tool registry.
    """
    ctx = getattr(request.state, "ai_context", None)

    adapter = get_provider(provider, default_model=model) if provider != DEFAULT_PROVIDER else _default_adapter()
    try:
        text, usage = await adapter.chat(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return {
            "text": text,
            "usage": {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "model": usage.model,
                "provider": usage.provider,
                "cost_usd": str(usage.cost_usd),
            },
        }
    finally:
        await adapter.close()
