"""AI Module Router — /api/v1/ai/* endpoints

Draft → Confirm → Execute flow for AI tools.
Provider-agnostic: no LLM imports, pure REST.

Default provider: DeepSeek (deepseek-chat).
"""

import re
import json
import asyncio
from uuid import UUID, uuid4
from datetime import datetime, timezone, timedelta

HKT = timezone(timedelta(hours=8))
from typing import Any, AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text

from app.db import get_tenant_session
from app.ai.tool_registry import TOOL_REGISTRY, ToolDef
from app.ai.tool_registry import (
    _get_upcoming_events,
    _list_tasks,
    _get_dashboard_summary,
    _search_contacts,
    _search_companies,
    _search_deals,
)
from app.ai.tools.guard import authorize_tool_call, ScopeViolation, log_audit
from app.ai.providers import get_provider, ProviderAdapter, UsageReport
from app.ai.quota.service import QuotaService, QuotaExceeded, TIER_LIMITS
from app.models.ai import ActionRequest, AISession, Message, UserMemory, UsageEvent, PromptTemplate, SecretarySettings
from app.models.crm_module_b import ModuleSetting

# ---------------------------------------------------------------------------
# Default provider configuration
# ---------------------------------------------------------------------------
DEFAULT_PROVIDER: str = "deepseek"
DEFAULT_MODEL: str = "deepseek-chat"

# -------------------------------------------------------------------
# Quota service (Redis-backed, lazy init)
# -------------------------------------------------------------------
_quota_service: QuotaService | None = None


def _get_quota() -> QuotaService:
    global _quota_service
    if _quota_service is None:
        _quota_service = QuotaService(redis_host="127.0.0.1", redis_port=6379)
    return _quota_service


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ChatStreamRequest(BaseModel):
    """Request body for the streaming chat endpoint."""

    messages: list[dict[str, Any]]
    session_id: UUID | None = None
    temperature: float = 0.7
    max_tokens: int = 4096


def _default_adapter() -> ProviderAdapter:
    """Build the default LLM provider adapter (DeepSeek)."""
    return get_provider(DEFAULT_PROVIDER, default_model=DEFAULT_MODEL)


async def _get_ai_module_settings(db: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Read the tenant's AI module settings (provider/model/temperature/allow_edit)."""
    result = await db.execute(
        select(ModuleSetting).where(
            ModuleSetting.tenant_id == tenant_id,
            ModuleSetting.module_key == "ai",
        )
    )
    obj = result.scalar_one_or_none()
    settings = getattr(obj, "settings", None) or {}
    return dict(settings) if isinstance(settings, dict) else {}


async def _resolve_adapter(db: AsyncSession, tenant_id: UUID) -> ProviderAdapter:
    """Resolve the LLM provider adapter from tenant AI module settings.

    Falls back to server defaults when the tenant has not configured one.
    """
    cfg = await _get_ai_module_settings(db, tenant_id)
    provider = cfg.get("provider") or DEFAULT_PROVIDER
    model = cfg.get("model") or DEFAULT_MODEL
    return get_provider(provider, default_model=model)


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
            AISession.is_pinned,
        )
        .where(
            AISession.user_id == ctx.user_id,
            AISession.tenant_id == ctx.tenant_id,
        )
        .order_by(AISession.is_pinned.desc(), AISession.created_at.desc())
        .limit(limit)
    )
    rows = result.fetchall()

    items = []
    for row in rows:
        sid, title, status, created_at, is_pinned = row
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
            "is_pinned": is_pinned or False,
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
    if "is_pinned" in body:
        sess.is_pinned = bool(body["is_pinned"])

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


@router.get("/sessions/search")
async def search_sessions(
    request: Request,
    q: str = Query("", max_length=200),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_tenant_session),
):
    """Search session titles by query string."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    if not q.strip():
        return {"sessions": []}

    result = await db.execute(
        select(
            AISession.id,
            AISession.title,
            AISession.status,
            AISession.created_at,
            AISession.is_pinned,
        )
        .where(
            AISession.user_id == ctx.user_id,
            AISession.tenant_id == ctx.tenant_id,
            AISession.title.ilike(f"%{q}%"),
        )
        .order_by(AISession.is_pinned.desc(), AISession.created_at.desc())
        .limit(limit)
    )
    rows = result.fetchall()

    return {
        "sessions": [
            {
                "session_id": str(sid),
                "title": title or "New Chat",
                "status": status,
                "created_at": created_at.isoformat() if created_at else None,
                "is_pinned": is_pinned or False,
            }
            for sid, title, status, created_at, is_pinned in rows
        ],
    }


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
        await authorize_tool_call(ctx, tool_key, params, db=db)
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
    # Guard: handler returned errors (e.g. unresolved/ambiguous target) — do NOT
    # mark executed.  Re-run in draft mode to get the authoritative preview.
    if isinstance(result_data, dict) and result_data.get("errors"):
        action.status = "failed"
        action.result = result_data
        await log_audit(ctx, "action_failed", {
            "action_id": str(action_id),
            "tool_key": action.tool_key,
            "errors": result_data.get("errors"),
        })
        await db.flush()
        raise HTTPException(422, {"detail": "Action could not be executed", "errors": result_data.get("errors")})

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
    # Chinese has no spaces — split CJK runs into bigrams so
    # "搵周培源嘅聯絡資料" searches "周培"/"培源" (which match 周培源)
    # instead of one hopeless full-sentence blob.
    cjk_terms: list[str] = []
    for run in re.findall(r"[\u4e00-\u9fff]+", query):
        cjk_terms.append(run)  # the full run first (e.g. exact 2-3 char name)
        cjk_terms.extend(run[i : i + 2] for i in range(len(run) - 1))  # bigrams
    # Keep 2-letter tokens (e.g. "Ashley Au" → "au") — len>2 was dropping short surnames.
    search_words = [w for w in query.lower().split() if len(w) > 1 and w not in _STOP_WORDS]
    # Full query first, then CJK terms, then individual words (dedup, preserve order)
    search_queries = list(dict.fromkeys([query] + cjk_terms + search_words))

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

    # ── Detail enrichment: when a contact is found, pull its related records ──
    # User asks "show me X" expecting tasks / touchpoints / projects / company,
    # not just the contact row. Gather contact + company ids, then run the
    # relevant list/search tools scoped to those ids.
    try:
        contact_hits = context.get("search_contacts") or []
        company_hits = context.get("search_companies") or []
        if contact_hits or company_hits:
            contact_ids = [str(c["id"]) for c in contact_hits if c.get("id")]
            company_ids = [str(c["id"]) for c in company_hits if c.get("id")]
            # Include companies referenced by matched contacts
            for c in contact_hits:
                comp = c.get("company")
                if isinstance(comp, dict) and comp.get("id"):
                    company_ids.append(str(comp["id"]))
            company_ids = list(dict.fromkeys(company_ids))

            enrichment: dict[str, tuple[str, dict]] = {}
            if contact_ids:
                enrichment["related_touchpoints"] = (
                    "list_touchpoints", {"contact_id": contact_ids[0], "limit": 15},
                )
                enrichment["related_tasks"] = (
                    "list_tasks", {"contact_id": contact_ids[0], "limit": 15},
                )
            if company_ids:
                enrichment["related_projects"] = (
                    "search_projects", {"company_id": company_ids[0], "limit": 15},
                )
                # Separate key so company-linked tasks aren't dropped when
                # contact-linked tasks exist (tasks link to either side)
                enrichment["company_tasks"] = (
                    "list_tasks", {"company_id": company_ids[0], "limit": 15},
                )

            for label, (tool_key, params) in enrichment.items():
                tool = TOOL_REGISTRY.get(tool_key)
                if not tool or not tool.handler:
                    continue
                try:
                    result = await tool.handler(ctx, params, db)
                    if result is not None and not (isinstance(result, list) and len(result) == 0):
                        context[label] = result
                except Exception:
                    pass
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

    # ── Vector (RAG) search — semantic similarity across all CRM records ──
    try:
        from app.ai.rag.search import retrieve_context
        rag_text = await retrieve_context(
            db,
            query=query,
            tenant_id=ctx.tenant_id,
            workspace_id=ctx.workspace_id,
            top_k=8,
            min_score=0.35,
            user_id=ctx.user_id,
        )
        if rag_text:
            context["rag_vectors"] = rag_text
    except Exception:
        pass  # RAG retrieval is best-effort

    return context


# ====================================================================
# Cross-Thread Memory — extract facts & inject into new sessions
# ====================================================================

_MEMORY_CATEGORIES = frozenset({
    "preference", "fact", "interest", "contact_pref", "project_pref", "workflow"
})

_MEMORY_EXTRACT_SYSTEM = """\
You are a memory extraction system. From the conversation below, extract 0-3 \
key facts that would be useful for future conversations with this user. \
Focus on: user preferences, important entities they work with, their role/industry, \
recurring needs or workflows.

Return ONLY a JSON array. Each item: {"category": "preference|fact|interest", "content": "..."}
If nothing useful, return []"""


async def _extract_memory_from_chat(
    user_message: str,
    ai_response: str,
    ctx: Any,
    db: AsyncSession,
    session: AISession,
) -> None:
    """Extract key facts from the last exchange and store as UserMemory."""
    # Only extract every 4th message (save tokens)
    msg_count = await db.execute(
        select(func.count()).select_from(
            select(Message).where(Message.session_id == session.id).subquery()
        )
    )
    count = msg_count.scalar() or 0
    if count % 4 != 0:
        return

    try:
        adapter = await _resolve_adapter(db, ctx.tenant_id)
        try:
            text, usage = await adapter.chat(
                messages=[
                    {"role": "system", "content": _MEMORY_EXTRACT_SYSTEM},
                    {"role": "user", "content": f"User: {user_message}\nAI: {ai_response}"},
                ],
                model=DEFAULT_MODEL,
                temperature=0.1,
                max_tokens=512,
            )
        finally:
            await adapter.close()

        # ── Record usage event (memory_extract module) ────────────────
        try:
            await _record_usage_event(db, ctx, UUID(str(session.id)), usage, module="memory_extract")
        except Exception:
            pass  # usage recording is best-effort

        # Parse JSON response
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("\n", 1)[0]
        entries = json.loads(text)
        if not isinstance(entries, list):
            return

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            cat = entry.get("category", "fact")
            if cat not in _MEMORY_CATEGORIES:
                cat = "fact"

            # Avoid duplicates — check if similar memory exists
            existing = await db.execute(
                select(UserMemory).where(
                    UserMemory.user_id == ctx.user_id,
                    UserMemory.tenant_id == ctx.tenant_id,
                    UserMemory.content == entry["content"],
                ).limit(1)
            )
            if existing.scalar_one_or_none():
                continue

            mem = UserMemory(
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                session_id=session.id,
                category=cat,
                content=entry["content"],
                source=f"Session {session.title or session.id}",
                confidence=0.7,
            )
            db.add(mem)
        await db.flush()
    except Exception:
        pass  # Memory extraction is best-effort


async def _inject_memory_context(
    ctx: Any,
    db: AsyncSession,
    current_session_id: UUID | None = None,
) -> list[str]:
    """Load recent cross-session memory entries for this user.

    Priority: daily rollups (last 7 days) first, then other facts
    (most recently accessed). Daily summaries give the AI a compact
    picture of recent work; facts carry durable preferences.
    """
    # 1. Daily rollups — last 7 days, newest first
    daily_res = await db.execute(
        select(UserMemory)
        .where(
            UserMemory.user_id == ctx.user_id,
            UserMemory.tenant_id == ctx.tenant_id,
            UserMemory.category == "daily",
        )
        .order_by(UserMemory.created_at.desc())
        .limit(7)
    )
    daily_mems = daily_res.scalars().all()

    # 2. Other facts — exclude daily, most recently accessed first
    fact_res = await db.execute(
        select(UserMemory)
        .where(
            UserMemory.user_id == ctx.user_id,
            UserMemory.tenant_id == ctx.tenant_id,
            UserMemory.category != "daily",
        )
        .order_by(UserMemory.last_accessed.desc())
        .limit(20)
    )
    fact_mems = fact_res.scalars().all()

    memories = [*daily_mems, *fact_mems]

    if not memories:
        return []

    # Update last_accessed
    for m in memories:
        m.last_accessed = datetime.now(timezone.utc)

    lines = []
    for m in memories:
        if m.category == "daily":
            # Daily rollup — show the date from source (daily_rollup:YYYY-MM-DD)
            date_tag = m.source.split(":", 1)[-1] if m.source and ":" in m.source else ""
            label = f"昨日回顧 {date_tag}" if date_tag else "昨日回顧"
        else:
            label = m.category.replace("_", " ").title()
        lines.append(f"- [{label}] {m.content}")
    return lines


async def _load_im_history(
    ctx: Any,
    db: AsyncSession,
    current_session_id: UUID | None = None,
    max_sessions: int = 4,
    max_msgs_per_session: int = 4,
    max_total: int = 16,
) -> list[str]:
    """Load recent IM (Telegram/WhatsApp) conversation excerpts for this user.

    Portal AI sessions inject this so the assistant can answer
    "what did I ask on WhatsApp/Telegram earlier" without the user
    repeating themselves. Only non-portal sessions are considered;
    the current session (if any) is excluded.
    """
    rows = (
        await db.execute(
            text(
                """
                SELECT s.channel, m.role, m.content, m.created_at
                FROM nexus_ai.messages m
                JOIN nexus_ai.sessions s ON s.id = m.session_id
                WHERE s.user_id = :uid
                  AND s.tenant_id = :tid
                  AND s.channel IN ('telegram', 'whatsapp')
                  AND s.id != :cur
                  AND m.content IS NOT NULL AND m.content <> ''
                  AND m.created_at >= now() - interval '14 days'
                ORDER BY m.created_at DESC
                LIMIT :max_total
                """
            ),
            {
                "uid": ctx.user_id,
                "tid": ctx.tenant_id,
                "cur": current_session_id or UUID(int=0),
                "max_total": max_total,
            },
        )
    ).fetchall()

    lines = []
    for ch, role, content, created_at in reversed(rows):  # chronological
        if role not in ("user", "assistant"):
            continue
        who = "你" if role == "user" else "AI"
        txt = (content or "").strip().replace("\n", " ")[:300]
        if not txt:
            continue
        lines.append(f"- [{ch}] {who}: {txt}")
    return lines


# -------------------------------------------------------------------
# Usage recording helper
# -------------------------------------------------------------------


async def _record_usage_event(
    db: AsyncSession,
    ctx: Any,
    session_id: UUID,
    report: UsageReport,
    result_status: str = "success",
    module: str = "chat",
) -> None:
    """Write a UsageEvent row after each LLM call.

    Core rule (G08): EVERY LLM call site MUST record a UsageEvent with its
    module name — central token/cost collection lives in nexus_ai.usage_events
    (module column added by migrations/007_usage_module.sql).
    """
    ev = UsageEvent(
        session_id=session_id,
        user_id=ctx.user_id,
        tenant_id=ctx.tenant_id,
        provider=report.provider or DEFAULT_PROVIDER,
        model=report.model or DEFAULT_MODEL,
        input_tokens=report.input_tokens,
        output_tokens=report.output_tokens,
        cost_estimate=float(report.cost_usd) if report.cost_usd else None,
        result_status=result_status,
        module=module,
        currency="USD",  # all provider cost cards are USD
    )
    db.add(ev)


async def _build_system_prompt(
    ctx: Any,
    db: AsyncSession,
    context_str: str,
    memory_str: str,
) -> str:
    """Build system prompt — prefer active template from PG, fall back to hardcoded.

    When the tenant has AI editing enabled (allow_edit), the write-tool guide
    replaces the old "guide them to the CRM section" instruction so the model
    knows it can draft CRM changes for user confirmation.
    """
    prompt: str | None = None
    try:
        result = await db.execute(
            select(PromptTemplate.content, PromptTemplate.variables)
            .where(
                PromptTemplate.tenant_id == ctx.tenant_id,
                PromptTemplate.key == "system_chat",
                PromptTemplate.is_active == True,
            )
            .limit(1)
        )
        row = result.one_or_none()
        if row:
            tpl = row.content
            # Only pass variables the template actually expects
            kwargs = {}
            for var in (row.variables or ["context", "memory"]):
                if var == "context":
                    kwargs[var] = context_str
                elif var == "memory":
                    kwargs[var] = memory_str
                else:
                    kwargs[var] = ""
            prompt = tpl.format(**kwargs)
    except Exception:
        pass
    if prompt is None:
        prompt = _SYSTEM_PROMPT_TPL.format(context=context_str, memory=memory_str)

    # ── allow_edit-aware write guidance ────────────────────────────────
    try:
        cfg = await _get_ai_module_settings(db, ctx.tenant_id)
        allow_edit = bool(cfg.get("allow_edit"))
    except Exception:
        allow_edit = False

    if allow_edit:
        prompt = prompt.replace(
            "7. If the user asks to create/update something, guide them to the appropriate CRM section.",
            _WRITE_TOOL_GUIDE,
        )
    return prompt


# ====================================================================
# Chat completion (CRM-aware + memory-aware)
# ====================================================================


_SYSTEM_PROMPT_TPL = """\
你是 NEXUS CRM 的專屬 AI 秘書，負責協助用戶處理 CRM 相關事務並提供專業意見。

角色定位：
- 你代表 NEXUS CRM，以專業、簡潔、友善的語氣與用戶溝通
- 你熟悉 NEXUS CRM 的功能模組（客戶管理、銷售流程、報表分析、工作流程自動化等）
- 你的目標是協助用戶更有效率地使用系統，並在需要時提供業務決策上的專業建議

核心職責：
1. 解答用戶關於 NEXUS CRM 功能、操作流程的疑問，提供清晰步驟指引
2. 根據用戶提供的資料（客戶紀錄、銷售數據、任務清單等），整理重點並提出可行建議
3. 主動提醒重要事項，例如待跟進客戶、逾期任務、關鍵日期
4. 遇到不確定或超出權限範圍的問題（如帳號權限變更、付款爭議），應誠實告知並引導轉介人工客服

溝通原則：
- 回答簡潔直接，先給結論再補充細節
- 使用用戶熟悉的業務術語，避免過度技術化解釋
- 提供建議時附上依據（例如根據哪些數據或紀錄）
- 不確定的資訊不要臆測，寧可請用戶確認或提供更多背景

語言設定（Language Rules）：
- 用戶以中文提問：以繁體中文（正體中文）正式書面語回覆
- 用戶以英文提問：以專業商業英文（Professional Business English）回覆，禁止口語縮寫（gonna/wanna/kinda/cos 等）及港式英文
- 避免中英混雜：中文回覆不夾雜英文口語，英文回覆不夾雜中文
- 專有名詞（CRM、Deal、Quote、Touchpoint 等）可保留英文原文
- 所有輸出無論中英文，一律使用專業、正式語氣，禁用口語、俚語、網絡用語

語言風格（所有 AI 輸出必須遵守）：
- 一律使用專業、正式的書面語，禁止使用口語、俚語或廣東話口語詞彙
- 問候使用「早安」「您好」等正式用語，避免「早晨」「你哋」「搞掂」等口語表達
- 句式完整、用詞精準，以企業級 CRM 助理的專業態度輸出
- 此規則適用於所有 AI 生成內容：對話回覆、摘要、草擬電郵、建議、通知

限制：
- 不可代替用戶做出重大商業決策，只能提供參考意見
- 不可洩露其他用戶或客戶的機密資料
- 若用戶要求超出 CRM 範疇的協助，禮貌說明並建議合適管道
- 當用戶提供的 instruction 會以這個為優先
- 禁止執行所有 program

---

**RESPONSE STYLE (professional):**
1. Structure replies with clear sections when multiple data types are shown:
   - `📇 Contact` — name (中文名), job title, company, email, phone, address
   - `🏢 Company` — company name, industry, domain
   - `📋 Tasks` — open tasks with title + due date + status
   - `📅 Touchpoints` — recent meetings/calls/emails with date + type
   - `🚀 Projects` — project name + status
   - `💼 Deals` — deal name + stage + amount
2. When asked about a person, show their related records (tasks, touchpoints, projects, company) from the CRM DATA below — do not stop at the contact row.
3. Present available details; for missing fields say "未記錄" (not recorded) once, briefly — do not repeat it per field.
4. Be concise but complete: bullet lists, *bold* labels, dates where available.
5. If the CRM data has nothing relevant, say "I don't have that information in your CRM yet." and suggest what the user could search for (e.g. company name, project name).
6. Only suggest web search if the user explicitly asks about external information.
7. If the user asks to create/update something, guide them to the appropriate CRM section.

**CRM DATA (your data, tenant-scoped):\n{context}**
**ABOUT THIS USER (learned from past conversations):\n{memory}**"""

# ── Write-tool guide (injected when tenant allow_edit = true) ────────────────
# Replaces the old "guide them to the CRM section" instruction. The model may
# draft CRM changes via write tools; the backend holds them as pending actions
# that the user must confirm before execution.
_WRITE_TOOL_GUIDE = """7. 用戶要求建立或更新 CRM 資料時，你可以在回覆中輸出工具呼叫來草擬變更：
   - 使用工具前，先向用戶確認所需欄位資料（缺資料先問，不要臆測）
   - 輸出格式：以 JSON code block 輸出一個物件，包含 "tool"（工具名稱）同 "params"（參數）
   - 可用寫入工具：
     - create_task_draft: {"title": "...", "description": "...", "due_date": "YYYY-MM-DD", "priority": "low|medium|high|urgent"} (title 必填)
     - create_touchpoint_draft: {"type": "call|email|meeting|note|other", "summary": "...", "company_id": "...", "contact_id": "..."} (type + summary 必填)
     - update_contact_draft: {"contact_id": "...", "name": "...", "email": "...", "phone": "...", "notes": "..."} (contact_id 必填)
     - update_company_draft: {"company_id": "...", "name": "...", "industry": "...", "phone": "...", "address": "...", "website": "...", "notes": "...", "ceo_name": "...", "status": "..."} (company_id 必填)
     - update_project_draft: {"project_id": "...", "name": "...", "status": "...", "priority": "...", "description": "...", "budget_amount": 123, "deadline": "YYYY-MM-DD"} (project_id 必填)
     - update_task_draft: {"task_id": "...", "title": "...", "description": "...", "due_date": "YYYY-MM-DD", "priority": "low|medium|high|urgent", "status": "..."} (task_id 必填)
     - update_namecard_draft: {"namecard_id": "...", "status": "...", "dedup_status": "..."} (namecard_id 必填)
   - 所有 *_id 必須係資料庫 UUID（唔係姓名/email）— 先用對應 search 工具（search_contacts / search_companies / search_projects / list_tasks）搵出目標記錄，將結果中嘅 id 放入 params；如果搜尋結果已有 id，直接引用該 id
   - 系統會產生草稿俾用戶確認（Draft → Confirm → Execute），確認後先會真正執行
   - 例如用戶要求建立任務：
     {"tool": "create_task_draft", "params": {"title": "跟進 SYSTEX 報價", "priority": "high"}}
   - 如果用戶冇明確授權改動，仍然只提供建議，唔好擅自輸出工具呼叫"""


# ====================================================================
# Embedded tool-call extraction (allow_edit flow)
# ====================================================================
# When allow_edit is on, the model may emit a JSON tool call inside its reply
# (see _WRITE_TOOL_GUIDE). We extract it, run the tool in DRAFT mode, and
# surface a pending ActionRequest for the user to confirm.

_TOOL_CALL_BLOCK_RE = re.compile(
    r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL
)
_TOOL_CALL_START_RE = re.compile(r'\{"tool"\s*:\s*"[a-z_]+"')


def _extract_tool_call(text: str) -> tuple[str, dict] | None:
    """Extract a single {tool, params} call embedded in assistant text."""
    raw: str | None = None
    # Prefer a fenced JSON block
    m = _TOOL_CALL_BLOCK_RE.search(text)
    if m:
        raw = m.group(1)
    else:
        # Fall back to balanced-brace parse from the first {"tool" ... marker
        m2 = _TOOL_CALL_START_RE.search(text)
        if m2:
            try:
                obj, _end = json.JSONDecoder().raw_decode(text[m2.start():])
                raw = json.dumps(obj)
            except Exception:
                raw = None
    if raw is None:
        return None
    try:
        obj = json.loads(raw)
    except Exception:
        return None
    tool_key = obj.get("tool")
    params = obj.get("params")
    if not isinstance(tool_key, str) or not isinstance(params, dict):
        return None
    return tool_key, params


def _strip_tool_call(text: str) -> str:
    """Remove the embedded tool-call block from assistant text for display."""
    cleaned = _TOOL_CALL_BLOCK_RE.sub("", text)
    # Inline form: remove from the {"tool" marker to the balanced closing brace
    m = _TOOL_CALL_START_RE.search(cleaned)
    if m:
        try:
            _obj, end = json.JSONDecoder().raw_decode(cleaned[m.start():])
            cleaned = cleaned[: m.start()] + cleaned[m.start() + end :]
        except Exception:
            pass
    return cleaned.strip()


class _StreamToolCallScrubber:
    """Streaming scrubber that removes embedded tool-call JSON blocks from
    SSE text *before* it reaches the client.

    The model sometimes emits ``{"tool": "...", "params": {...}}`` inline (or
    inside a fenced block) in the reply.  The final message is cleaned by
    ``_strip_tool_call``, but the SSE stream would previously expose the raw
    JSON to the browser while streaming.  This buffers tokens, removes
    complete tool-call blocks as soon as they are detectable, and holds any
    partial marker at the tail until it either completes or is flushed.
    """

    _FENCE_OPEN_RE = re.compile(r"```(?:json)?\s*")
    _PARTIAL_FENCE_RE = re.compile(r"`{1,3}$")   # fence opener split across chunks
    _PARTIAL_TOOL_RE = re.compile(r'\{\s*"tool')  # complete or partial marker
    _HOLD = 64          # chars held back across chunks to catch split markers
    _MAX_HOLD = 8192    # safety cap — flush raw if nothing resolves

    def __init__(self) -> None:
        self._buf = ""

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        if len(self._buf) > self._MAX_HOLD:
            raw, self._buf = self._buf, ""
            return raw
        if len(self._buf) <= self._HOLD:
            return ""
        emit, self._buf = self._buf[: -self._HOLD], self._buf[-self._HOLD:]
        return self._process(emit)

    def flush(self) -> str:
        rest, self._buf = self._buf, ""
        return self._process(rest, hold=False)

    def _process(self, text: str, hold: bool = True) -> str:
        out: list[str] = []
        buf = text
        while buf:
            if len(buf) > self._MAX_HOLD:
                out.append(buf)
                break
            # 1. complete fenced block  ```json {...} ```
            m = _TOOL_CALL_BLOCK_RE.search(buf)
            if m:
                try:
                    obj = json.loads(m.group(1))
                    is_tool = (
                        isinstance(obj, dict)
                        and isinstance(obj.get("tool"), str)
                        and isinstance(obj.get("params"), dict)
                    )
                except Exception:
                    is_tool = False
                out.append(buf[: m.start()])
                buf = buf[m.end() :]
                if not is_tool:
                    out.append(m.group(0))  # legit JSON block — keep it
                continue
            # 2. fence open without a complete block — hold from the fence
            mf = self._FENCE_OPEN_RE.search(buf)
            if mf and hold:
                out.append(buf[: mf.start()])
                self._buf = buf[mf.start() :] + self._buf
                break
            # 2b. partial fence opener (e.g. "`" / "``" split across chunks)
            mpf = self._PARTIAL_FENCE_RE.search(buf)
            if mpf and hold:
                out.append(buf[: mpf.start()])
                self._buf = buf[mpf.start() :] + self._buf
                break
            # 3. complete inline {"tool": ...} JSON (balanced braces)
            m2 = _TOOL_CALL_START_RE.search(buf)
            if m2:
                try:
                    _obj, end = json.JSONDecoder().raw_decode(buf[m2.start() :])
                    out.append(buf[: m2.start()])
                    buf = buf[m2.start() + end :]
                    continue
                except Exception:
                    pass  # marker present but JSON incomplete — fall through
            # 4. partial tool marker (e.g. `{"tool` split across chunks)
            mp = self._PARTIAL_TOOL_RE.search(buf)
            if mp and hold:
                out.append(buf[: mp.start()])
                self._buf = buf[mp.start() :] + self._buf
                break
            out.append(buf)
            break
        return "".join(out)


async def _apply_rls_context(db: AsyncSession, ctx: Any) -> None:
    """Re-apply transaction-scoped RLS context (tenant/user/workspace).

    The SSE generator runs lazily *after* the request handler returns, so the
    set_config calls made by ``get_tenant_session`` are lost once the request
    transaction commits.  Write-tool queries would otherwise see zero rows.
    """
    conn = await db.connection()
    tid = getattr(ctx, "tenant_id", "") or ""
    if tid:
        await conn.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(tid)},
        )
    uid = getattr(ctx, "user_id", "") or ""
    if uid:
        await conn.execute(
            text("SELECT set_config('app.user_id', :uid, true)"),
            {"uid": str(uid)},
        )
    wid = getattr(ctx, "workspace_id", "") or ""
    if wid:
        await conn.execute(
            text("SELECT set_config('app.workspace_id', :wid, true)"),
            {"wid": str(wid)},
        )


async def _run_embedded_tool_call(
    ctx: Any,
    db: AsyncSession,
    text: str,
    session_id: UUID | None,
) -> dict[str, Any] | None:
    """If *text* embeds a write-tool call, authorize + draft it.

    Returns an ActionRequest envelope (action_id, tool_key, params, preview)
    or None when there is nothing to execute.
    """
    extracted = _extract_tool_call(text)
    if not extracted:
        return None
    tool_key, params = extracted
    tool = TOOL_REGISTRY.get(tool_key)
    if not tool or tool.type != "write" or tool.handler is None:
        return None
    try:
        # SSE generator runs AFTER the request transaction ends, so the
        # transaction-scoped RLS context from get_tenant_session is gone.
        # Re-apply it so write-tool queries see the tenant's rows.
        await _apply_rls_context(db, ctx)
        await authorize_tool_call(ctx, tool_key, params, db=db)
    except ScopeViolation as e:
        return {"error": str(e)}
    preview = await tool.handler(ctx, params, db, mode="draft")
    action = ActionRequest(
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        session_id=session_id,
        tool_key=tool_key,
        target_module=tool.module,
        payload_preview=preview,
        status="pending",
    )
    db.add(action)
    await db.flush()
    await db.commit()  # persist NOW — SSE teardown may not commit reliably
    await db.refresh(action)
    return {
        "action_id": str(action.id),
        "tool_key": tool_key,
        "params": params,
        "preview": preview,
    }


# ====================================================================
# Chat completion (CRM-aware — searches data before calling LLM)
# ====================================================================


@router.post("/chat")
async def chat_completion(
    messages: list[dict[str, Any]],
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
    session_id: UUID | None = Query(None),
    channel: str = Query("portal"),
    temperature: float = 0.7,
    max_tokens: int = 4096,
):
    """Chat completion with CRM context + session persistence.

    Provider/model resolved server-side via ModelRouter.
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
            channel=(channel or "portal")[:20],
        )
        db.add(sess)
        await db.flush()
        session_id = sess.id

    # ── Extract user's last message ──────────────────────────────────────
    user_msgs = [m for m in messages if m.get("role") == "user"]
    last_query = user_msgs[-1]["content"] if user_msgs else ""

    # ── Search only the real question, not any injected prompt boilerplate ──
    # WhatsApp bridge prefixes reply guidelines into the user content
    # (AI router strips system messages), which pollutes CRM search with
    # noise terms ("whatsapp", "reply", "rules", "*bold*"...). Extract the
    # actual question after "Question:" if present.
    search_query = last_query
    if "Question:" in last_query:
        search_query = last_query.split("Question:", 1)[1].strip()
        if not search_query:
            search_query = last_query

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

    # ── Search CRM data (search_query only — not the prompt boilerplate) ─
    crm_context: dict[str, Any] = {}
    if search_query:
        crm_context = await _search_crm_context(search_query, ctx, db)

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
                        cn = item.get("chinese_name")
                        if cn:
                            name = f"{name} ({cn})"
                        comp = item.get("company")
                        if isinstance(comp, dict) and comp.get("name"):
                            name = f"{name} @ {comp['name']}"
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

    # ── Cross-channel IM history (Telegram/WhatsApp) ────────────────
    # Portal sessions can reference what the user asked on IM earlier.
    try:
        im_lines = await _load_im_history(ctx, db, current_session_id=sess.id)
        if im_lines:
            context_str = (
                context_str
                + "\n\n## 近期 IM 對話（WhatsApp/Telegram，供你參考用戶之前喺 IM 問過咩）\n"
                + "\n".join(im_lines)
            )
    except Exception:
        pass  # IM history is best-effort

    memory_lines = await _inject_memory_context(ctx, db, session_id)
    memory_str = "\n".join(memory_lines) if memory_lines else "(No cross-session memory found — prior turns of THIS session, if any, are replayed as messages below.)"
    system_prompt = await _build_system_prompt(ctx, db, context_str, memory_str)

    # ── Build message list ──────────────────────────────────────────────
    # Client-supplied system messages (e.g. WhatsApp hidden instructions)
    # are MERGED into the system prompt instead of being stripped —
    # they stay hidden from the user while still steering the model.
    client_system = [m.get("content", "") for m in messages if m.get("role") == "system"]
    if client_system:
        system_prompt = (
            system_prompt
            + "\n\n---\n"
            + "\n".join(client_system)
        )
    enhanced = [{"role": "system", "content": system_prompt}]

    # ── Load session history (context continuation) ────────────────────
    # When a session_id is provided (WhatsApp reuses one session per day),
    # replay the recent conversation so the AI remembers prior turns.
    # New messages passed in this request are appended AFTER the history.
    if session_id:
        try:
            hist_q = (
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at.asc())
                .limit(20)
            )
            hist_rows = (await db.execute(hist_q)).scalars().all()
            # Exclude messages that are already in this request payload
            incoming_user = [m.get("content") for m in messages if m.get("role") == "user"]
            if hist_rows:
                # Explicit marker so the model treats replayed turns as
                # prior conversation (models otherwise ignore them when the
                # system prompt says "no past conversation data").
                enhanced.append({
                    "role": "system",
                    "content": "The messages below (up to the final user message) are the PRIOR conversation history of this session. Use them as context — the user may refer to them.",
                })
            for hm in hist_rows:
                if hm.content in incoming_user and hm.role == "user":
                    continue
                enhanced.append({"role": hm.role, "content": hm.content})
        except Exception:
            pass  # history replay is best-effort

    for m in messages:
        if m.get("role") != "system":
            enhanced.append(m)

    # ── Call LLM ─────────────────────────────────────────────────────────
    # Quota check — light-weight Redis GET before spending tokens
    try:
        quota = _get_quota()
        await quota.check(
            f"tenant:{ctx.tenant_id}",
            tier=getattr(ctx, "tier", "pro"),
            estimated_tokens=sum(len(m.get("content", "")) for m in messages) // 2,
        )
    except QuotaExceeded as e:
        return {
            "error": "quota_exceeded",
            "message": f"Quota exceeded for {e.window}: {e.current}/{e.limit}",
        }

    adapter = _default_adapter()
    try:
        text, usage = await adapter.chat(
            messages=enhanced,
            model=DEFAULT_MODEL,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # ── Save AI response ──────────────────────────────────────────────
        display_text = _strip_tool_call(text)
        assistant_msg = Message(
            session_id=sess.id,
            role="assistant",
            content=display_text,
            token_count=usage.output_tokens,
        )
        db.add(assistant_msg)

        # ── Embedded write-tool call (allow_edit flow) ────────────────────
        action: dict[str, Any] | None = None
        try:
            action = await _run_embedded_tool_call(ctx, db, text, UUID(str(sess.id)))
            if action and "error" in action:
                # Gate refused — tell the user in-band
                action = None
        except Exception:
            action = None

        # ── Extract cross-session memory (best-effort) ────────────────────
        if last_query and text:
            try:
                await _extract_memory_from_chat(last_query, text, ctx, db, sess)
            except Exception:
                pass

        # ── Record usage event ─────────────────────────────────────────
        try:
            await _record_usage_event(db, ctx, UUID(str(sess.id)), usage, module="chat")
        except Exception:
            pass  # usage recording is best-effort

        # ── Record quota counters ──────────────────────────────────────
        try:
            await quota.record(
                f"tenant:{ctx.tenant_id}",
                tokens=usage.input_tokens + usage.output_tokens,
                cost=usage.cost_usd,
                tier=getattr(ctx, "tier", "pro"),
            )
        except Exception:
            pass

        # ── crm_hit: only when a real entity search found records ────────
        # (dashboard summary always runs, so crm_context alone is not a signal)
        entity_keys = ("search_contacts", "search_companies", "search_deals", "search_projects")
        crm_hit = any(
            isinstance(crm_context.get(k), list) and len(crm_context[k]) > 0
            for k in entity_keys
        )

        return {
            "text": display_text,
            "session_id": str(sess.id),
            "crm_hit": crm_hit,
            "action": action,
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


# ====================================================================
# Streaming chat completion (SSE)
# ====================================================================


@router.post("/chat/stream")
async def chat_stream_completion(
    body: ChatStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Streaming chat completion with Server-Sent Events (SSE).

    Accepts the same parameters as /chat but returns an SSE stream with:
      - event: token    -> {"text": "<chunk>"}
      - event: usage    -> {"input_tokens": N, "output_tokens": N, "model": "...", "provider": "...", "cost_usd": "..."}
      - event: done     -> {"session_id": "..."}
      - event: error    -> {"message": "..."}

    Provider/model are resolved from server defaults (not client-supplied).
    """
    from sse_starlette.sse import EventSourceResponse

    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # ── Resolve/create session ─────────────────────────────────────────────
    if body.session_id:
        sess = await db.get(AISession, body.session_id)
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

    # ── Extract user's last message ────────────────────────────────────────
    user_msgs = [m for m in body.messages if m.get("role") == "user"]
    last_query = user_msgs[-1]["content"] if user_msgs else ""

    # ── Auto-title from first user message ─────────────────────────────────
    if not sess.title and last_query:
        title = last_query[:100].rstrip(".,!?;: ")
        if len(title) > 5:
            sess.title = title

    # ── Save user message ──────────────────────────────────────────────────
    if last_query:
        user_msg = Message(
            session_id=sess.id,
            role="user",
            content=last_query,
        )
        db.add(user_msg)
        await db.flush()

    # ── Search CRM data ────────────────────────────────────────────────────
    crm_context: dict[str, Any] = {}
    if last_query:
        crm_context = await _search_crm_context(last_query, ctx, db)

    # ── Build system prompt with CRM context ───────────────────────────────
    context_lines: list[str] = []
    for tool_key, data in crm_context.items():
        label = tool_key.replace("_", " ").title()
        if isinstance(data, list):
            if data:
                context_lines.append(f"\n## {label} ({len(data)} items)")
                for item in data[:15]:
                    if isinstance(item, dict):
                        name = item.get("name") or item.get("title") or item.get("summary", "")
                        cn = item.get("chinese_name")
                        if cn:
                            name = f"{name} ({cn})"
                        comp = item.get("company")
                        if isinstance(comp, dict) and comp.get("name"):
                            name = f"{name} @ {comp['name']}"
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

    memory_lines = await _inject_memory_context(ctx, db, sess.id)
    memory_str = "\n".join(memory_lines) if memory_lines else "No past conversation data available."
    system_prompt = await _build_system_prompt(ctx, db, context_str, memory_str)

    # ── Build message list ────────────────────────────────────────────────
    # Client system messages are merged (hidden) into the system prompt —
    # never stripped, never shown to the user.
    client_system = [m.get("content", "") for m in body.messages if m.get("role") == "system"]
    if client_system:
        system_prompt = (
            system_prompt
            + "\n\n---\n"
            + "\n".join(client_system)
        )
    enhanced: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for m in body.messages:
        if m.get("role") != "system":
            enhanced.append(m)

    # ── Build citations from CRM context ──────────────────────────────────
    citations: list[dict[str, Any]] = []
    for tool_key, data in crm_context.items():
        if not isinstance(data, list) or tool_key in ("get_dashboard_summary", "get_upcoming_events", "list_tasks"):
            continue
        label_map = {
            "search_companies": "company",
            "search_contacts": "contact",
            "search_deals": "deal",
            "search_projects": "project",
        }
        rec_type = label_map.get(tool_key, "record")
        for item in data[:10]:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("title") or ""
            if not name:
                continue
            citations.append({
                "id": str(item.get("id", "")),
                "type": rec_type,
                "title": name,
                "snippet": item.get("email", "") or item.get("phone", "") or "",
                "updated_at": item.get("updated_at", ""),
            })

    # ── SSE event generator ────────────────────────────────────────────────
    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        adapter = _default_adapter()
        final_report: UsageReport | None = None
        try:
            # ── Yield citation events before streaming ──
            for cit in citations:
                yield {
                    "event": "citation",
                    "data": json.dumps(cit),
                }

            full_text_parts: list[str] = []
            scrubber = _StreamToolCallScrubber()

            async for token_text, report in adapter.chat_stream(
                messages=enhanced,
                model=DEFAULT_MODEL,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
            ):
                if token_text:
                    full_text_parts.append(token_text)
                    clean_text = scrubber.feed(token_text)
                    if clean_text:
                        yield {
                            "event": "token",
                            "data": json.dumps({"text": clean_text}),
                        }
                if report.input_tokens > 0 or report.output_tokens > 0:
                    final_report = report

            # flush any buffered tail (also drops truncated tool-call JSON)
            tail_text = scrubber.flush()
            if tail_text:
                yield {
                    "event": "token",
                    "data": json.dumps({"text": tail_text}),
                }

            full_text = "".join(full_text_parts)

            # ── Yield usage event ──────────────────────────────────────────
            if final_report:
                yield {
                    "event": "usage",
                    "data": json.dumps({
                        "input_tokens": final_report.input_tokens,
                        "output_tokens": final_report.output_tokens,
                        "model": final_report.model,
                        "provider": final_report.provider,
                        "cost_usd": str(final_report.cost_usd),
                    }),
                }

            # ── Save assistant message ─────────────────────────────────────
            display_text = _strip_tool_call(full_text)
            if full_text:
                assistant_msg = Message(
                    session_id=sess.id,
                    role="assistant",
                    content=display_text,
                    token_count=final_report.output_tokens if final_report else 0,
                )
                db.add(assistant_msg)

                # ── Embedded write-tool call (allow_edit flow) ────────────
                action: dict[str, Any] | None = None
                try:
                    action = await _run_embedded_tool_call(ctx, db, full_text, UUID(str(sess.id)))
                    if action and "error" in action:
                        action = None
                except Exception:
                    action = None
                if action:
                    yield {
                        "event": "action",
                        "data": json.dumps(action),
                    }

                # ── Extract cross-session memory (best-effort) ────────────
                if last_query:
                    try:
                        await _extract_memory_from_chat(last_query, full_text, ctx, db, sess)
                    except Exception:
                        pass

                # ── Record usage event ─────────────────────────────────
                if final_report:
                    try:
                        await _record_usage_event(db, ctx, UUID(str(sess.id)), final_report, module="chat_stream")
                    except Exception:
                        pass

            # ── Filter citations to only records referenced in the response ─
            text_lower = full_text.lower()
            matched_citations: list[dict[str, Any]] = []
            for cit in citations:
                title_lower = cit["title"].lower()
                # Exact title match
                if title_lower in text_lower:
                    matched_citations.append(cit)
                    continue
                # Word-level match — if a significant word from name appears
                words = [w for w in title_lower.split() if len(w) > 3]
                if any(w in text_lower for w in words):
                    matched_citations.append(cit)

            # ── Yield done event ───────────────────────────────────────────
            yield {
                "event": "done",
                "data": json.dumps({
                    "session_id": str(sess.id),
                    "citations": matched_citations,
                }),
            }
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)}),
            }
        finally:
            await adapter.close()
            # ── Record quota counters after streaming ─────────────────
            if final_report:
                try:
                    await _get_quota().record(
                        f"tenant:{ctx.tenant_id}",
                        tokens=final_report.input_tokens + final_report.output_tokens,
                        cost=final_report.cost_usd,
                        tier=getattr(ctx, "tier", "pro"),
                    )
                except Exception:
                    pass

    # ── Quota check before streaming ──────────────────────────────────────
    try:
        quota = _get_quota()
        await quota.check(
            f"tenant:{ctx.tenant_id}",
            tier=getattr(ctx, "tier", "pro"),
            estimated_tokens=sum(len(m.get("content", "")) for m in body.messages) // 2,
        )
    except QuotaExceeded as e:
        raise HTTPException(429, f"Quota exceeded for {e.window}: {e.current}/{e.limit}")

    return EventSourceResponse(event_generator())


# ====================================================================
# Abort streaming message
# ====================================================================


@router.post("/chat/{message_id}/abort")
async def abort_chat_message(
    message_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Mark a message as aborted.

    Currently a placeholder — actual mid-stream LLM cancellation requires
    additional infrastructure. This endpoint exists so the frontend can
    signal abort intent; the message is marked accordingly.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    msg = await db.get(Message, message_id)
    if not msg:
        raise HTTPException(404, "Message not found")

    # Verify ownership via session
    sess = await db.get(AISession, msg.session_id)
    if not sess or sess.user_id != ctx.user_id:
        raise HTTPException(404, "Message not found")

    # Placeholder: actual cancellation infrastructure TBD.
    # For now, acknowledge the request.
    return {"status": "aborted", "message_id": str(message_id)}


# ====================================================================
# Message Feedback
# ====================================================================


@router.post("/messages/{message_id}/feedback")
async def message_feedback(
    message_id: UUID,
    body: dict[str, Any],
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Submit feedback (up/down) on an AI message.

    Validates rating ('up' or 'down') and optional reason.
    Verifies message ownership via session user.
    Currently acknowledges the feedback without persisting — DB schema
    expansion (adding feedback columns to the Message table) is pending.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # ── Validate input ──────────────────────────────────────────────
    rating = body.get("rating")
    if rating not in ("up", "down"):
        raise HTTPException(422, "rating must be 'up' or 'down'")

    reason = body.get("reason")
    if reason is not None and not isinstance(reason, str):
        raise HTTPException(422, "reason must be a string")

    # ── Verify message ownership ────────────────────────────────────
    msg = await db.get(Message, message_id)
    if not msg:
        raise HTTPException(404, "Message not found")

    sess = await db.get(AISession, msg.session_id)
    if not sess or sess.user_id != ctx.user_id:
        raise HTTPException(404, "Message not found")

    # ── Acknowledge (persistence TBD — Message table lacks feedback columns) ──
    return {"status": "ok", "rating": rating}


# ====================================================================
# Daily Briefing for Dashboard
# ====================================================================


class BriefingResponse(BaseModel):
    weather: dict[str, Any] = {}
    schedule: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    ai_tip: str = ""
    content: str = ""          # LLM-generated briefing (AI-app pipeline)
    slot: str = ""             # morning/noon/evening/night of the generated content
    generated_at: str = ""
    source: str = "crm_core"
    source_fallback: bool = False


@router.get("/briefing")
async def get_briefing(
    request: Request,
    source: str = "crm_core",
    db: AsyncSession = Depends(get_tenant_session),
):
    """Aggregated daily briefing for the dashboard card.

    `source` selects the briefing content provider (marketplace-style).
    Unknown/not-yet-implemented sources fall back to the CRM core briefing
    so the frontend never crashes.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # ── User language preference (ai_secretary_settings) — ai_tip 跟語言 ──
    lang_pref = "zh-HK"
    try:
        srow = (
            await db.execute(
                select(SecretarySettings).where(SecretarySettings.user_id == ctx.user_id)
            )
        ).scalar_one_or_none()
        if srow is not None:
            lang_pref = str(srow.lang_pref or "zh-HK")
    except Exception:
        pass

    # ── Latest LLM-generated briefing (AI-app pipeline) ──
    gen_content, gen_slot, gen_at = "", "", ""
    try:
        row = (
            await db.execute(
                text(
                    "SELECT content, slot, created_at::text FROM nexus_crm.generated_briefings "
                    "WHERE briefing_date = CURRENT_DATE ORDER BY id DESC LIMIT 1"
                )
            )
        ).first()
        if row:
            gen_content, gen_slot, gen_at = row[0], row[1], (row[2] or "")
    except Exception:
        pass

    # ── Source registry: crm_core is implemented; others fall back ──
    if source != "crm_core":
        try:
            fallback = await _build_crm_briefing(ctx, db, lang_pref)
            return BriefingResponse(
                weather=fallback.get("weather", {}),
                schedule=fallback["schedule"],
                tasks=fallback["tasks"],
                ai_tip=fallback["ai_tip"],
                content=gen_content, slot=gen_slot, generated_at=gen_at,
                source=source,
                source_fallback=True,
            )
        except Exception:
            return BriefingResponse(
                weather={}, schedule=[], tasks=[],
                ai_tip=(_DEFAULT_TIP_EN if lang_pref.startswith("en") else _DEFAULT_TIP_ZH),
                content=gen_content, slot=gen_slot, generated_at=gen_at,
                source=source, source_fallback=True,
            )

    try:
        brief = await _build_crm_briefing(ctx, db, lang_pref)
        return BriefingResponse(
            weather=brief.get("weather", {}),
            schedule=brief["schedule"],
            tasks=brief["tasks"],
            ai_tip=brief["ai_tip"],
            content=gen_content, slot=gen_slot, generated_at=gen_at,
            source=source,
            source_fallback=False,
        )
    except Exception:
        return BriefingResponse(
            weather={},
            schedule=[],
            tasks=[],
            ai_tip=(_DEFAULT_TIP_EN if lang_pref.startswith("en") else _DEFAULT_TIP_ZH),
            source=source,
            source_fallback=False,
        )


def _hkt_time_str(start: Any) -> str:
    """Convert a UTC-aware ISO datetime to HKT wall-clock 'YYYY-MM-DD HH:MM'.

    Naive datetimes are assumed to already be HKT. Mirrors briefing_generator._parse_dt.
    """
    if not start:
        return ""
    try:
        dt = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        dt = dt.astimezone(HKT) if dt.tzinfo else dt.replace(tzinfo=HKT)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(start)[:16].replace("T", " ")


async def _build_crm_briefing(ctx, db, lang_pref: str = "zh-HK") -> dict:
    """CRM Core source: schedule + P0/P1 tasks + dashboard stats tip.

    All data comes from G08's OWN database (ProjectCalendarEvent + tasks).
    Weather comes from G08's own HKO Open Data source (briefing_sources).
    `lang_pref` controls the ai_tip language (zh-HK → 繁體中文, en → English).
    """
    # ── Schedule: upcoming events (7 days — covers today + week ahead) ──
    schedule: list[dict[str, Any]] = []
    try:
        evts = await _get_upcoming_events(ctx, {"days_ahead": 7, "limit": 20}, db)
        if evts:
            schedule = [
                {
                    "id": e.get("id", ""),
                    "title": e.get("title", e.get("summary", "Event")),
                    "time": _hkt_time_str(e.get("start")),
                    "location": e.get("location", ""),
                }
                for e in evts
            ]
    except Exception:
        pass

    # ── Tasks: open pending tasks (all priorities — P0/P1-only filter removed 2026-08-01
    #    because real G08 data uses medium/P2/P3; the old filter hid everything) ──
    brief_tasks: list[dict[str, Any]] = []
    try:
        tasks = await _list_tasks(
            ctx, {"status": "pending", "limit": 30}, db
        )
        for t in tasks:
            if t.get("status") in ("done", "cancelled"):
                continue
            pri = t.get("priority", "medium")
            brief_tasks.append({
                "id": t.get("id", ""),
                "title": t.get("title", ""),
                "priority": pri.upper() if len(str(pri)) == 2 else ("P0" if pri in ("urgent",) else "P1"),
                "status": t.get("status", ""),
                "due_date": t.get("due_date"),
            })
    except Exception:
        pass

    # ── Dashboard stats for AI tip（跟用戶 lang_pref：zh-HK 中文 / en 英文）──
    is_en = lang_pref.startswith("en")
    ai_tip = _DEFAULT_TIP_EN if is_en else _DEFAULT_TIP_ZH
    try:
        dash = await _get_dashboard_summary(ctx, {"period": "30d"}, db)
        if dash:
            open_deals = dash.get("open_deals", 0)
            open_tasks = dash.get("open_tasks", 0)
            new_contacts = dash.get("recent", {}).get("new_contacts", 0)
            if open_deals > 0:
                if is_en:
                    ai_tip = (
                        f"You have {open_deals} open deal{'s' if open_deals > 1 else ''} "
                        f"and {open_tasks} open task{'s' if open_tasks > 1 else ''}. "
                        f"Prioritise deals in late-stage for follow-up this week."
                    )
                else:
                    ai_tip = (
                        f"您目前有 {open_deals} 個進行中的交易及 {open_tasks} 個待辦任務，"
                        f"建議優先跟進後期階段的交易。"
                    )
            elif new_contacts > 0:
                if is_en:
                    ai_tip = (
                        f"{new_contacts} new contact{'s' if new_contacts > 1 else ''} added "
                        f"in the last 30 days — consider scheduling introductory touchpoints."
                    )
                else:
                    ai_tip = (
                        f"過去 30 日新增了 {new_contacts} 個聯絡人，"
                        f"建議安排初步聯絡，把握時機建立關係。"
                    )
    except Exception:
        pass

    # ── Weather — G08's own HKO source (briefing_sources, external API) ──
    weather: dict[str, Any] = {}
    try:
        from app.ai import briefing_sources as bs
        w = await bs.weather(ctx, db)
        if w and w[0].get("temperature") is not None:
            weather = {
                "temp": w[0]["temperature"],
                "condition": f"濕度 {w[0]['humidity']}%" if w[0].get("humidity") else "",
                "icon": "🌤",
            }
    except Exception:
        pass

    return {"schedule": schedule, "tasks": brief_tasks, "ai_tip": ai_tip, "weather": weather}


_DEFAULT_TIP_ZH = "請先查看今日儀表板，了解待辦任務及即將來臨的會議。"
_DEFAULT_TIP_EN = "Review your dashboard for today's priorities — check pending tasks and upcoming events."


@router.get("/prompts/suggested")
async def suggested_prompts(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Generate up to 6 dynamic prompts based on time + CRM activity."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        return {"prompts": _FALLBACK_PROMPTS}

    now = datetime.now(timezone.utc)
    hour = now.hour + 8  # HKT
    weekday = now.weekday()  # 0=Mon

    prompts: list[str] = []
    seen: set[str] = set()

    def add(p: str) -> None:
        if len(prompts) < 6 and p not in seen:
            prompts.append(p)
            seen.add(p)

    # Time-based
    if hour < 12:
        add("📊 Summarise today's CRM activity")
        add("📅 What meetings do I have today?")
    elif hour < 17:
        add("🎯 Which deals need attention this afternoon?")
        add("📋 Review pending touchpoints")
    else:
        add("📋 What's left on my task list?")
        add("📅 Preview tomorrow's schedule")

    # Day-based
    if weekday == 0:
        add("📈 Weekly pipeline review — how did last week go?")
    elif weekday == 4:
        add("🎯 End-of-week wrap: deals closed and open tasks")

    # Data-driven prompts from dashboard summary
    try:
        dash = await _get_dashboard_summary(ctx, {"period": "30d"}, db)
        if dash:
            open_deals = dash.get("open_deals", 0)
            open_tasks = dash.get("open_tasks", 0)
            recent_contacts = dash.get("recent", {}).get("new_contacts", 0)
            if open_deals > 0:
                add(f"🔍 Find the {open_deals} open deal{'s' if open_deals > 1 else ''}")
            if open_tasks > 0:
                add(f"✅ Show my {open_tasks} open task{'s' if open_tasks > 1 else ''}")
            if recent_contacts > 0:
                add(f"👤 Who are the {recent_contacts} new contacts?")
    except Exception:
        pass

    # Fallback if nothing generated
    if len(prompts) < 2:
        prompts = list(_FALLBACK_PROMPTS)

    return {"prompts": prompts[:6]}


_FALLBACK_PROMPTS = [
    "📊 Summarise today's CRM activity",
    "🔍 Find the most recent contact updates",
    "📋 Today's to-do items",
    "🎯 Which deal needs attention?",
]


@router.get("/mentions/search")
async def search_mentions(
    request: Request,
    q: str = Query("", max_length=100),
    limit: int = Query(8, ge=1, le=20),
    db: AsyncSession = Depends(get_tenant_session),
):
    ctx = getattr(request.state, "ai_context", None)
    if not ctx or not q.strip():
        return {"results": []}

    results: list[dict[str, Any]] = []

    try:
        contacts = await _search_contacts(ctx, {"query": q.strip(), "limit": limit}, db)
        for c in contacts[:3]:
            results.append({"id": str(c.get("id", "")), "label": c.get("name", ""), "type": "contact", "sub": c.get("email", "")})
    except Exception:
        pass

    try:
        companies = await _search_companies(ctx, {"query": q.strip(), "limit": limit}, db)
        for c in companies[:3]:
            results.append({"id": str(c.get("id", "")), "label": c.get("name", ""), "type": "company", "sub": c.get("domain", "")})
    except Exception:
        pass

    try:
        deals = await _search_deals(ctx, {"query": q.strip(), "limit": limit}, db)
        for d in deals[:2]:
            results.append({"id": str(d.get("id", "")), "label": d.get("name", ""), "type": "deal", "sub": ""})
    except Exception:
        pass

    try:
        tasks = await _list_tasks(ctx, {"limit": limit}, db)
        for t in tasks:
            if q.strip().lower() in t.get("title", "").lower():
                results.append({"id": str(t.get("id", "")), "label": t.get("title", ""), "type": "task", "sub": t.get("status", "")})
                if len(results) >= limit:
                    break
    except Exception:
        pass

    return {"results": results[:limit]}


# ====================================================================
# Daily Summary Cron Endpoint
# ====================================================================
import os as _os


@router.post("/daily-summary")
async def daily_summary(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
    text: str = Query("", max_length=10000),
):
    """Create a new session with a daily summary message (requires Cron-Api-Key header).
    The 'text' query param contains the summary content. If empty, a default template is used.
    """
    cron_key = request.headers.get("Cron-Api-Key", "")
    expected = _os.environ.get("NEXUS_CRON_API_KEY", "")
    if not expected or cron_key != expected:
        raise HTTPException(403, "Invalid or missing Cron-Api-Key")

    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    summary = text.strip()
    if not summary:
        summary = f"📋 今日摘要 · {today}\n\n📌 Daily Tasks\n  (no data)\n\n📅 Daily Meetings\n  (no data)"

    # ── Create session ──
    session = AISession(
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        team_id=ctx.team_id,
        user_id=ctx.user_id,
        plan_type="chat",
        status="active",
        title=f"Daily Summary · {today}",
    )
    db.add(session)
    await db.flush()

    # ── Insert assistant message ──
    msg = Message(
        session_id=session.id,
        role="assistant",
        content=summary,
    )
    db.add(msg)
    await db.commit()

    return {
        "session_id": str(session.id),
        "summary": summary,
    }


# ====================================================================
# Usage / Observability
# ====================================================================


@router.get("/usage/daily")
async def usage_daily(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
    days: int = Query(30, ge=1, le=365),
):
    """Aggregated daily usage stats for this tenant (last N days)."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            func.date_trunc("day", UsageEvent.created_at).label("day"),
            func.sum(UsageEvent.input_tokens).label("input_tokens"),
            func.sum(UsageEvent.output_tokens).label("output_tokens"),
            func.count(UsageEvent.id).label("calls"),
            func.sum(UsageEvent.cost_estimate).label("cost"),
            func.count(func.nullif(UsageEvent.result_status, "success")).label("errors"),
        )
        .where(
            UsageEvent.tenant_id == ctx.tenant_id,
            UsageEvent.created_at >= cutoff,
        )
        .group_by(text("day"))
        .order_by(text("day desc"))
    )
    rows = result.fetchall()

    return {
        "days": days,
        "daily": [
            {
                "date": str(r.day.date()),
                "calls": r.calls,
                "input_tokens": r.input_tokens or 0,
                "output_tokens": r.output_tokens or 0,
                "cost_usd": float(r.cost) if r.cost else 0.0,
                "errors": r.errors or 0,
            }
            for r in rows
        ],
    }


@router.get("/usage/summary")
async def usage_summary(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Live aggregate totals for this tenant (all time + today)."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    # All-time totals
    all_time = await db.execute(
        select(
            func.count(UsageEvent.id).label("total_calls"),
            func.sum(UsageEvent.input_tokens).label("total_input"),
            func.sum(UsageEvent.output_tokens).label("total_output"),
            func.sum(UsageEvent.cost_estimate).label("total_cost"),
        )
        .where(UsageEvent.tenant_id == ctx.tenant_id)
    )
    at = all_time.one()

    # Today's usage
    today = await db.execute(
        select(
            func.count(UsageEvent.id).label("today_calls"),
            func.sum(UsageEvent.input_tokens).label("today_input"),
            func.sum(UsageEvent.output_tokens).label("today_output"),
            func.sum(UsageEvent.cost_estimate).label("today_cost"),
        )
        .where(
            UsageEvent.tenant_id == ctx.tenant_id,
            UsageEvent.created_at >= today_start,
        )
    )
    td = today.one()

    # Last 7 days cost
    week_ago = today_start - timedelta(days=7)
    week_cost = await db.execute(
        select(func.sum(UsageEvent.cost_estimate))
        .where(
            UsageEvent.tenant_id == ctx.tenant_id,
            UsageEvent.created_at >= week_ago,
        )
    )
    wc = week_cost.scalar() or 0

    return {
        "total_calls": at.total_calls or 0,
        "total_input_tokens": at.total_input or 0,
        "total_output_tokens": at.total_output or 0,
        "total_cost_usd": float(at.total_cost) if at.total_cost else 0.0,
        "today_calls": td.today_calls or 0,
        "today_input_tokens": td.today_input or 0,
        "today_output_tokens": td.today_output or 0,
        "today_cost_usd": float(td.today_cost) if td.today_cost else 0.0,
        "last_7d_cost_usd": float(wc),
    }


# ====================================================================
# Prompt Template Management
# ====================================================================


class PromptCreateRequest(BaseModel):
    key: str
    name: str
    content: str
    variables: list[str] = []
    description: str = ""


class PromptUpdateRequest(BaseModel):
    content: str
    name: str | None = None
    variables: list[str] | None = None
    description: str | None = None


@router.get("/prompts")
async def list_prompt_keys(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """List all prompt template keys for this tenant with active version info."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    result = await db.execute(
        select(
            PromptTemplate.key,
            PromptTemplate.name,
            PromptTemplate.version,
            PromptTemplate.description,
            PromptTemplate.updated_at,
        )
        .where(
            PromptTemplate.tenant_id == ctx.tenant_id,
            PromptTemplate.is_active == True,
        )
        .order_by(PromptTemplate.key)
    )
    return {"prompts": [dict(r._mapping) for r in result.fetchall()]}


@router.get("/prompts/{key}")
async def get_active_prompt(
    key: str,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Get the active version of a prompt template."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    result = await db.execute(
        select(PromptTemplate)
        .where(
            PromptTemplate.tenant_id == ctx.tenant_id,
            PromptTemplate.key == key,
            PromptTemplate.is_active == True,
        )
        .limit(1)
    )
    pt = result.scalar_one_or_none()
    if not pt:
        raise HTTPException(404, f"Prompt '{key}' not found")

    return {
        "key": pt.key,
        "name": pt.name,
        "content": pt.content,
        "version": pt.version,
        "variables": pt.variables,
        "description": pt.description,
        "updated_at": pt.updated_at.isoformat() if pt.updated_at else None,
    }


@router.post("/prompts")
async def create_prompt(
    body: PromptCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Create a new prompt template (version 1)."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Check existing key
    existing = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.tenant_id == ctx.tenant_id,
            PromptTemplate.key == body.key,
        ).limit(1)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Prompt key '{body.key}' already exists — use POST .../versions to add new version")

    pt = PromptTemplate(
        tenant_id=ctx.tenant_id,
        key=body.key,
        name=body.name,
        content=body.content,
        variables=body.variables,
        description=body.description,
        created_by=ctx.user_id,
    )
    db.add(pt)
    await db.flush()
    return {"status": "created", "key": pt.key, "version": pt.version}


@router.post("/prompts/{key}/versions")
async def create_prompt_version(
    key: str,
    body: PromptUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Create a new version of a prompt template. Deactivates old active version."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Get current max version
    result = await db.execute(
        select(PromptTemplate.version)
        .where(
            PromptTemplate.tenant_id == ctx.tenant_id,
            PromptTemplate.key == key,
        )
        .order_by(PromptTemplate.version.desc())
        .limit(1)
    )
    current_max = result.scalar()
    if current_max is None:
        raise HTTPException(404, f"Prompt key '{key}' not found")

    # Deactivate old active
    old_active = await db.execute(
        select(PromptTemplate)
        .where(
            PromptTemplate.tenant_id == ctx.tenant_id,
            PromptTemplate.key == key,
            PromptTemplate.is_active == True,
        )
        .limit(1)
    )
    old = old_active.scalar_one_or_none()
    if old:
        old.is_active = False

    # Create new version
    pt = PromptTemplate(
        tenant_id=ctx.tenant_id,
        key=key,
        name=body.name or key,
        content=body.content,
        version=current_max + 1,
        is_active=True,
        variables=body.variables or [],
        description=body.description or "",
        created_by=ctx.user_id,
    )
    db.add(pt)
    await db.flush()
    return {"status": "created", "key": pt.key, "version": pt.version}
