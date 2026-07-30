"""RAG (Retrieval-Augmented Generation) router — /api/v1/ai/rag/* endpoints.

Provides semantic search across vector-embedded CRM records.
Tenant-scoped via JWT auth middleware.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_tenant_session
from app.ai.rag.search import (
    embed_query,
    vector_search,
    retrieve_context,
)
from app.ai.rag.reindex import reindex_tenant, delete_tenant_vectors

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ai/rag", tags=["AI RAG"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    min_score: float = 0.35
    source_module: str | None = None


class ReindexRequest(BaseModel):
    """Trigger re-indexing for specific modules or all CRM entities."""
    source_modules: list[str] | None = None  # None = all


# ---------------------------------------------------------------------------
# Search endpoint
# ---------------------------------------------------------------------------


@router.post("/search")
async def rag_search(
    body: SearchRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Semantic search across vector-embedded CRM records.

    Returns ranked chunks with cosine similarity scores.
    All results are tenant-scoped.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    if not body.query.strip():
        return {"results": [], "query": body.query}

    # Embed the query
    query_vector = await embed_query(body.query)

    # Search
    hits = await vector_search(
        db,
        query_vector=query_vector,
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        top_k=body.top_k,
        min_score=body.min_score,
        source_module=body.source_module,
    )

    return {
        "query": body.query,
        "results": [h.to_dict() for h in hits],
        "total": len(hits),
    }


# ---------------------------------------------------------------------------
# Context retrieval endpoint (for frontend / LLM pre-fetch)
# ---------------------------------------------------------------------------


@router.post("/context")
async def rag_context(
    body: SearchRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Get RAG context as formatted text for LLM injection.

    Returns a markdown-formatted string ready to insert into a system prompt.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    if not body.query.strip():
        return {"context": ""}

    context_str = await retrieve_context(
        db,
        query=body.query,
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        top_k=body.top_k,
        min_score=body.min_score,
        source_module=body.source_module,
    )

    return {"context": context_str}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@router.get("/health")
async def rag_health():
    """Check RAG module readiness."""
    # Quick test: can we import and call embed?
    try:
        vec = await embed_query("test", model="text-embedding-3-small")
        vec_ok = len(vec) == 1536 and any(v != 0.0 for v in vec)
    except Exception:
        vec_ok = False

    return {
        "status": "ok" if vec_ok else "degraded",
        "embedding_ready": vec_ok,
        "embedding_dims": 1536,
        "default_embedding_model": "text-embedding-3-small",
        "vector_index": "pgvector cosine similarity (brin/ivfflat)",
    }


# ---------------------------------------------------------------------------
# Re-index all CRM entities for the current tenant
# ---------------------------------------------------------------------------


@router.post("/reindex")
async def rag_reindex(
    body: ReindexRequest,
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
):
    """Bulk re-index all CRM entities into the vector store.

    Deletes existing vectors for the tenant first, then re-creates them.
    May take 30-120s depending on data volume.
    """
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    # Delete existing vectors
    deleted = await delete_tenant_vectors(
        db,
        tenant_id=ctx.tenant_id,
        source_modules=body.source_modules,
    )

    # Re-index
    stats = await reindex_tenant(
        db,
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        source_modules=body.source_modules,
    )

    return {
        "status": "ok",
        "deleted": deleted,
        "documents_created": stats["total_docs"],
        "chunks_created": stats["total_chunks"],
        "modules": stats["modules"],
    }


@router.delete("/vectors")
async def rag_delete_vectors(
    request: Request,
    db: AsyncSession = Depends(get_tenant_session),
    source_modules: str | None = Query(None, description="Comma-separated module names"),
):
    """Delete all vector data for the current tenant (or specific modules)."""
    ctx = getattr(request.state, "ai_context", None)
    if not ctx:
        raise HTTPException(400, "AI session context not initialized")

    modules = source_modules.split(",") if source_modules else None
    deleted = await delete_tenant_vectors(
        db,
        tenant_id=ctx.tenant_id,
        source_modules=modules,
    )

    return {"status": "ok", "deleted": deleted}
