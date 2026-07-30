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
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db import get_tenant_session
from app.ai.tool_registry import TOOL_REGISTRY, ToolDef
from app.ai.tools.guard import authorize_tool_call, ScopeViolation, log_audit
from app.ai.providers import get_provider, ProviderAdapter
from app.models.ai import ActionRequest, AISession, Message

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
# Session management
# ====================================================================


@router.post("/sessions")
async def create_session(
    request: Request,
    title: str = Query("", max_length=200),
    db: AsyncSession = Depends(get_tenant_session),
):
    """Create a new AI chat session."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    session = AISession(
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        team_id=ctx.team_id,
        user_id=ctx.user_id,
        plan_type="chat",
        status="active",
    )
    if title:
        session.title = title
    db.add(session)
    await db.flush()
    return {"session_id": str(session.id), "created_at": session.created_at.isoformat()}


@router.get("/sessions")
async def list_sessions(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_tenant_session),
):
    """List user's chat sessions, most recent first."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Get sessions + latest message preview for each
    result = await db.execute(
        select(
            AISession.id,
            AISession.title,
            AISession.status,
            AISession.created_at,
        )
        .where(
            AISession.user_id == ctx.user_id,
            AISession.tenant_id == ctx.tenant_id,
        )
        .order_by(AISession.created_at.desc())
        .limit(limit)
    )
    rows = result.fetchall()

    items = []
    for row in rows:
        sid, title, status, created_at = row
        # Get last message for preview
        last_msg = await db.execute(
            select(Message.content)
            .where(Message.session_id == sid)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_content = last_msg.scalar_one_or_none()

        if not title and last_content:
            title = last_content[:60]

        items.append({
            "session_id": str(sid),
            "title": title or "New Chat",
            "status": status,
            "created_at": created_at.isoformat() if created_at else None,
        })

    return {"sessions": items}


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: UUID,
    request: Request,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_tenant_session),
):
    """Get all messages for a session."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Verify ownership
    sess = await db.get(AISession, session_id)
    if not sess or sess.user_id != ctx.user_id:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc())
        .limit(limit)
    )
    messages = result.scalars().all()

    return {
        "session_id": str(session_id),
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: UUID,
    body: dict[str, Any],
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Update session title or status."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    sess = await db.get(AISession, session_id)
    if not sess or sess.user_id != ctx.user_id:
        raise HTTPException(404, "Session not found")

    if "title" in body:
        sess.title = body["title"]
    if "status" in body:
        if body["status"] not in ("active", "archived", "deleted"):
            raise HTTPException(400, "Invalid status")
        sess.status = body["status"]
        if body["status"] in ("archived", "deleted"):
            sess.ended_at = datetime.now(timezone.utc)

    await db.flush()
    return {"status": "updated"}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Delete a session and all its messages."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    sess = await db.get(AISession, session_id)
    if not sess or sess.user_id != ctx.user_id:
        raise HTTPException(404, "Session not found")

    await db.delete(sess)
    return {"status": "deleted"}


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
    session_id: UUID | None = Query(None),
    model: str = DEFAULT_MODEL,
    provider: str = DEFAULT_PROVIDER,
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """Chat completion with CRM context + session persistence.

    Accepts a session_id to continue an existing conversation.
    Saves every user message and AI response to the messages table.
    Auto-generates session title from the first user message.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # ── Resolve/create session ───────────────────────────────────────────
    if session_id:
        sess = await db.get(AISession, session_id)
        if not sess or sess.user_id != ctx.user_id:
            raise HTTPException(404, "Session not found")
    else:
        sess = AISession(
            tenant_id=ctx.tenant_id,
            workspace_id=ctx.workspace_id,
            team_id=ctx.team_id,
            user_id=ctx.user_id,
            status="active",
        )
        db.add(sess)
        await db.flush()
        session_id = sess.id

    # ── Extract user's last message ──────────────────────────────────────
    user_msgs = [m for m in messages if m.get("role") == "user"]
    last_query = user_msgs[-1]["content"] if user_msgs else ""

    # ── Auto-title from first user message ──────────────────────────────
    is_new = not sess.title
    if is_new and last_query:
        title = last_query[:100].rstrip(".,!?;: ")
        if len(title) > 5:
            sess.title = title

    # ── Save user message ────────────────────────────────────────────────
    if last_query:
        user_msg = Message(
            session_id=sess.id,
            role="user",
            content=last_query,
        )
        db.add(user_msg)
        await db.flush()

    # ── Search CRM data ──────────────────────────────────────────────────
    crm_context: dict[str, Any] = {}
    if last_query:
        crm_context = await _search_crm_context(last_query, ctx, db)

    # ── Build system prompt with CRM context ─────────────────────────────
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

    # ── Build message list ──────────────────────────────────────────────
    enhanced = [{"role": "system", "content": system_prompt}]
    for m in messages:
        if m.get("role") != "system":
            enhanced.append(m)

    # ── Call LLM ─────────────────────────────────────────────────────────
    adapter = _default_adapter()
    try:
        text, usage = await adapter.chat(
            messages=enhanced,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # ── Save AI response ──────────────────────────────────────────────
        assistant_msg = Message(
            session_id=sess.id,
            role="assistant",
            content=text,
            token_count=usage.output_tokens,
        )
        db.add(assistant_msg)

        return {
            "text": text,
            "session_id": str(sess.id),
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
