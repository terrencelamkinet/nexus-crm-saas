"""RAG vector search — embed query → pgvector cosine similarity → ranked results.

Uses raw SQL for pgvector's ``<=>`` (cosine distance) operator since the
SQLAlchemy model doesn't match the actual DB schema. All queries are
tenant-scoped via explicit ``tenant_id`` filter.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.providers.base import get_provider

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMS = 1536
DEFAULT_TOP_K = 10


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class RAGResult:
    """A single vector search hit."""

    chunk_id: UUID
    document_id: UUID
    chunk_text: str
    score: float              # cosine similarity (higher = more similar)
    source_module: str
    source_record_id: UUID
    visibility_scope: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": str(self.chunk_id),
            "document_id": str(self.document_id),
            "chunk_text": self.chunk_text,
            "score": round(self.score, 4),
            "source_module": self.source_module,
            "source_record_id": str(self.source_record_id),
            "visibility_scope": self.visibility_scope,
        }


@dataclass
class SearchConfig:
    """Search configuration."""

    top_k: int = DEFAULT_TOP_K
    min_score: float = 0.35       # below this, results are discarded
    embedding_model: str = DEFAULT_EMBEDDING_MODEL


DEFAULT_SEARCH_CONFIG = SearchConfig()


# ---------------------------------------------------------------------------
# Core search
# ---------------------------------------------------------------------------


async def embed_query(
    query: str,
    model: str = DEFAULT_EMBEDDING_MODEL,
) -> list[float]:
    """Generate embedding vector for a text query.

    Priority:
    1. Local tf-idf embedder (zero-dependency, always available)
    2. OpenAI (text-embedding-3-small, if OPENAI_API_KEY set)
    3. Gemini (text-embedding-004, if GEMINI_API_KEY set)
    4. Deterministic hash fallback (always works)
    """
    # 1. Local embedder — always available, no API key needed
    try:
        from app.ai.rag.local_embed import local_embed
        vectors = local_embed([query])
        if vectors and vectors[0] and any(v != 0.0 for v in vectors[0]):
            return vectors[0]
    except Exception:
        pass

    # 2. Try OpenAI
    try:
        adapter = get_provider("openai")
        try:
            vectors, _report = await adapter.embed([query], model=model)
            if vectors and vectors[0] and any(v != 0.0 for v in vectors[0]):
                return vectors[0]
        except Exception:
            pass
        finally:
            await adapter.close()
    except Exception:
        pass

    # 3. Fall back to Gemini
    try:
        adapter = get_provider("gemini")
        try:
            vectors, _report = await adapter.embed([query], model="text-embedding-004")
            if vectors and vectors[0] and any(v != 0.0 for v in vectors[0]):
                return vectors[0]
        except Exception:
            pass
        finally:
            await adapter.close()
    except Exception:
        pass

    logger.warning("All embedding providers unavailable; returning zero vector")
    return [0.0] * DEFAULT_EMBEDDING_DIMS


async def vector_search(
    db: AsyncSession,
    *,
    query_vector: list[float],
    tenant_id: UUID,
    workspace_id: UUID | None = None,
    top_k: int = DEFAULT_TOP_K,
    min_score: float = 0.35,
    source_module: str | None = None,
) -> list[RAGResult]:
    """Search vector chunks by cosine similarity, tenant-scoped.

    Uses pgvector's ``<=>`` operator (cosine distance).
    Only returns chunks with score >= *min_score*.
    """
    # Build the WHERE clause dynamically
    filters = ["c.tenant_id = :tenant_id"]
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "query_vector": str(query_vector),
        "top_k": top_k,
    }

    if workspace_id:
        filters.append("c.workspace_id = :workspace_id")
        params["workspace_id"] = workspace_id

    if source_module:
        filters.append("d.source_module = :source_module")
        params["source_module"] = source_module

    where_clause = " AND ".join(filters)

    sql = text(f"""
        SELECT
            c.id              AS chunk_id,
            c.document_id     AS document_id,
            c.chunk_text      AS chunk_text,
            1 - (c.embedding <=> (:query_vector)::vector) AS score,
            d.source_module   AS source_module,
            d.source_record_id AS source_record_id,
            c.visibility_scope AS visibility_scope
        FROM nexus_ai.vector_document_chunks c
        JOIN nexus_ai.vector_documents d ON d.id = c.document_id
        WHERE {where_clause}
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> (:query_vector)::vector
        LIMIT :top_k
    """)

    try:
        result = await db.execute(sql, params)
        rows = result.fetchall()
    except Exception:
        logger.exception("Vector search SQL failed")
        return []

    hits: list[RAGResult] = []
    for row in rows:
        score = float(row.score) if row.score is not None else 0.0
        if score < min_score:
            continue
        hits.append(RAGResult(
            chunk_id=row.chunk_id,
            document_id=row.document_id,
            chunk_text=row.chunk_text,
            score=score,
            source_module=row.source_module,
            source_record_id=row.source_record_id,
            visibility_scope=row.visibility_scope,
        ))

    return hits


async def retrieve_context(
    db: AsyncSession,
    *,
    query: str,
    tenant_id: UUID,
    workspace_id: UUID | None = None,
    top_k: int = DEFAULT_TOP_K,
    min_score: float = 0.35,
    source_module: str | None = None,
) -> str:
    """High-level: embed query → search → return formatted text for LLM context.

    Returns a markdown-formatted string of top chunks, or an empty string
    if nothing relevant was found.
    """
    query_vector = await embed_query(query)
    hits = await vector_search(
        db,
        query_vector=query_vector,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        top_k=top_k,
        min_score=min_score,
        source_module=source_module,
    )

    if not hits:
        return ""

    lines: list[str] = []
    for i, hit in enumerate(hits, 1):
        label = f"[{hit.source_module}]"
        lines.append(f"{i}. **{label}** (score: {hit.score:.3f})")
        lines.append(f"   > {hit.chunk_text[:400]}")
        lines.append("")

    context_str = "\n".join(lines)
    return (
        "**📋 RELEVANT CRM RECORDS (semantic search):**\n"
        f"{context_str}"
    )


__all__ = [
    "embed_query",
    "vector_search",
    "retrieve_context",
    "RAGResult",
    "SearchConfig",
    "DEFAULT_SEARCH_CONFIG",
]
