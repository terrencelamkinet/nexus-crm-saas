"""AI Module Router — /api/v1/ai/* endpoints

Draft → Confirm → Execute flow for AI tools.
Provider-agnostic: no LLM imports, pure REST.

Default provider: DeepSeek (deepseek-chat).
"""

import re
import json
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
            session_id=None,
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
# CRM context retrieval — search user's data before calling LLM
# ====================================================================

_INTENT_PATTERNS: dict[str, list[str]] = {
    "search_companies": [r"compan(y|ies)", r"organization", r"vendor", r"supplier"],
    "search_contacts": [r"contact", r"person", r"people", r"who\s"],
    "list_tasks": [r"task", r"(?:to-)?do", r"assign", r"deadline", r"overdue"],
    "search_deals": [r"deal", r"opportunity", r"pipeline", r"sale"],
    "search_projects": [r"project", r"engagement"],
    "list_touchpoints": [r"touchpoint", r"meeting", r"call", r"email"],
    "get_dashboard_summary": [r"summar", r"overview", r"dashboard", r"(?:how\s)?many"],
    "get_upcoming_events": [r"upcoming", r"schedule", r"calendar", r"event"],
}


async def _search_crm_context(
    query: str,
    ctx: Any,
    db: AsyncSession,
) -> dict[str, Any]:
    """Search CRM data relevant to the user's query.

    ALWAYS searches companies + contacts with the query term.
    Also runs specialised searches when specific keywords are detected.
    Returns a dict mapping tool keys to their results.
    """
    context: dict[str, Any] = {}
    msg_lower = query.lower()

    # ── Entity search (ALWAYS runs — user might mention a company/contact name) ──
    # Extract searchable terms: filter out common stop words, use the remaining words
    _STOP_WORDS = frozenset({
        "tell", "me", "about", "show", "find", "search", "look", "for", "get",
        "what", "who", "where", "when", "why", "how", "is", "are", "was", "were",
        "do", "does", "did", "can", "could", "would", "should", "will", "may",
        "the", "a", "an", "in", "on", "at", "to", "of", "by", "with", "from",
        "and", "or", "but", "not", "all", "any", "some", "please", "need", "want",
        "has", "have", "had", "been", "being", "am", "be", "this", "that", "these",
        "those", "it", "its", "they", "them", "their", "he", "she", "his", "her",
        "my", "your", "our", "i", "you", "we",
    })
    search_words = [w for w in query.lower().split() if len(w) > 2 and w not in _STOP_WORDS]
    search_queries = [query] + search_words  # Try full query first, then individual words

    entity_tools: list[str] = []
    for t in ("search_companies", "search_contacts"):
        tool = TOOL_REGISTRY.get(t)
        if tool and tool.handler:
            entity_tools.append(t)

    for tool_key in entity_tools:
        try:
            tool = TOOL_REGISTRY[tool_key]
            # Try each search term until we get results
            for sq in search_queries:
                result = await tool.handler(ctx, {"query": sq, "limit": 25}, db)
                if result is not None and not (isinstance(result, list) and len(result) == 0):
                    context[tool_key] = result
                    break
        except Exception:
            pass

    # ── Intent-driven specialised searches (only when keywords match) ──
    _INTENT_PATTERNS: dict[str, list[str]] = {
        "search_deals": [r"deal", r"opportunity", r"pipeline", r"sale"],
        "search_projects": [r"project", r"engagement"],
        "list_tasks": [r"task", r"(?:to-)?do", r"assign", r"deadline", r"overdue"],
        "list_touchpoints": [r"touchpoint", r"meeting", r"call", r"email"],
        "get_upcoming_events": [r"upcoming", r"schedule", r"calendar", r"event"],
        "get_dashboard_summary": [r"summar", r"overview", r"dashboard", r"(?:how\s)?many"],
    }

    tools_to_call: set[str] = set()
    for tool_key, patterns in _INTENT_PATTERNS.items():
        if any(re.search(p, msg_lower) for p in patterns):
            tools_to_call.add(tool_key)

    # Always include dashboard overview
    tools_to_call.add("get_dashboard_summary")

    for tool_key in tools_to_call:
        tool = TOOL_REGISTRY.get(tool_key)
        if not tool or not tool.handler:
            continue
        try:
            if tool_key in ("search_deals", "search_projects"):
                result = await tool.handler(ctx, {"query": query, "limit": 25}, db)
            elif tool_key == "list_tasks":
                result = await tool.handler(ctx, {"limit": 30}, db)
            elif tool_key == "list_touchpoints":
                result = await tool.handler(ctx, {"limit": 30}, db)
            elif tool_key == "get_dashboard_summary":
                result = await tool.handler(ctx, {"period": "30d"}, db)
            elif tool_key == "get_upcoming_events":
                result = await tool.handler(ctx, {"days_ahead": 30, "limit": 20}, db)
            else:
                result = await tool.handler(ctx, {}, db)

            if result is not None and not (isinstance(result, list) and len(result) == 0):
                context[tool_key] = result
        except Exception:
            pass

    return context


_SYSTEM_PROMPT_TPL = """\
You are NEXUS AI, the intelligent assistant for NEXUS CRM. \
You help users manage their customer relationships.

**RULES:**
1. Answer FIRST from the CRM data provided below. Be specific — mention names, counts, dates.
2. If the CRM data has nothing relevant, say "I don't have that information in your CRM yet."
3. Only suggest web search if the user explicitly asks about external information.
4. Keep responses concise. Use bullet points for lists.
5. If the user asks to create/update something, guide them to the appropriate CRM section.

**CRM DATA (your data, tenant-scoped):\n{context}**"""


# ====================================================================
# Chat completion (CRM-aware — searches data before calling LLM)
# ====================================================================


@router.post("/chat")
async def chat_completion(
    messages: list[dict[str, Any]],
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
    model: str = DEFAULT_MODEL,
    provider: str = DEFAULT_PROVIDER,
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """Chat completion with automatic CRM context retrieval.

    Before calling the LLM, searches CRM data relevant to the user's
    query and includes it as context in the system prompt.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Extract user's last message
    user_msgs = [m for m in messages if m.get("role") == "user"]
    last_query = user_msgs[-1]["content"] if user_msgs else ""

    # Search CRM data
    crm_context: dict[str, Any] = {}
    if last_query:
        crm_context = await _search_crm_context(last_query, ctx, db)

    # Format CRM context as readable text
    context_lines: list[str] = []
    for tool_key, data in crm_context.items():
        label = tool_key.replace("_", " ").title()
        if isinstance(data, list):
            if data:
                context_lines.append(f"\n## {label} ({len(data)} items)")
                for item in data[:15]:
                    if isinstance(item, dict):
                        name = item.get("name") or item.get("title") or item.get("summary", "")
                        context_lines.append(f"- {name}")
                        if "email" in item:
                            context_lines[-1] += f" ({item['email']})"
                        if "phone" in item:
                            context_lines[-1] += f" tel:{item['phone']}"
                    else:
                        context_lines.append(f"- {item}")
            else:
                context_lines.append(f"\n## {label}: (none found)")
        elif isinstance(data, dict):
            parts = [f"{k}: {v}" for k, v in data.items() if not isinstance(v, dict)]
            context_lines.append(f"\n## {label}: {', '.join(parts)}")
        else:
            context_lines.append(f"\n## {label}: {data}")

    context_str = "\n".join(context_lines).strip()
    if not context_str:
        context_str = "No CRM data found matching this query."

    system_prompt = _SYSTEM_PROMPT_TPL.format(context=context_str)

    # Build message list: system prompt + original messages (skip any existing system msg)
    enhanced = [{"role": "system", "content": system_prompt}]
    for m in messages:
        if m.get("role") != "system":
            enhanced.append(m)

    adapter = _default_adapter()
    try:
        text, usage = await adapter.chat(
            messages=enhanced,
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
