"""Bulk text re-indexer for RAG vector store.

Reads all CRM entities (companies, contacts, deals, etc.) and creates
vector documents + chunks with embeddings.

Uses raw SQL to match the actual DB schema (nexus_ai.vector_documents
and nexus_ai.vector_document_chunks).
"""

from __future__ import annotations

import logging
import asyncio
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.rag.search import DEFAULT_EMBEDDING_DIMS, embed_query

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Entity queries — extract text to index from each CRM module
# ---------------------------------------------------------------------------

CRMDoc = dict[str, Any]

ENTITY_QUERIES: list[tuple[str, str, str]] = [
    (
        "company",
        "nexus_crm.companies",
        """
        SELECT id, name, description, industry, notes
        FROM nexus_crm.companies
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
    (
        "contact",
        "nexus_crm.contacts",
        """
        SELECT id, name, email, phone, position, notes
        FROM nexus_crm.contacts
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
    (
        "deal",
        "nexus_crm.deals",
        """
        SELECT id, name, value, stage, notes
        FROM nexus_crm.deals
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
    (
        "task",
        "nexus_crm.tasks",
        """
        SELECT id, title, description
        FROM nexus_crm.tasks
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
    (
        "touchpoint",
        "nexus_crm.touchpoints",
        """
        SELECT id, title, notes, summary
        FROM nexus_crm.touchpoints
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
    (
        "project",
        "nexus_crm.projects",
        """
        SELECT id, name, description
        FROM nexus_crm.projects
        WHERE tenant_id = :tenant_id
          AND deleted_at IS NULL
        """,
    ),
]

NOTES_QUERY = """
    SELECT n.id AS note_id, n.content, n.entity_type, n.entity_id
    FROM nexus_crm.notes n
    WHERE n.tenant_id = :tenant_id
      AND n.deleted_at IS NULL
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_row(module: str, row: dict[str, Any]) -> str:
    """Format a CRM record row into indexable text."""
    parts: list[str] = []

    if module == "company":
        parts.append(f"Company: {row.get('name', '')}")
        if row.get("industry"):
            parts.append(f"Industry: {row['industry']}")
        if row.get("description"):
            parts.append(f"Description: {row['description']}")
        if row.get("notes"):
            parts.append(f"Notes: {row['notes']}")

    elif module == "contact":
        parts.append(f"Contact: {row.get('name', '')}")
        if row.get("email"):
            parts.append(f"Email: {row['email']}")
        if row.get("phone"):
            parts.append(f"Phone: {row['phone']}")
        if row.get("position"):
            parts.append(f"Position: {row['position']}")
        if row.get("notes"):
            parts.append(f"Notes: {row['notes']}")

    elif module == "deal":
        parts.append(f"Deal: {row.get('name', '')}")
        if row.get("value"):
            parts.append(f"Value: {row['value']}")
        if row.get("stage"):
            parts.append(f"Stage: {row['stage']}")
        if row.get("notes"):
            parts.append(f"Notes: {row['notes']}")

    elif module == "task":
        parts.append(f"Task: {row.get('title', '')}")
        if row.get("description"):
            parts.append(f"Description: {row['description']}")

    elif module == "touchpoint":
        parts.append(f"Touchpoint: {row.get('title', '')}")
        if row.get("notes"):
            parts.append(f"Notes: {row['notes']}")
        if row.get("summary"):
            parts.append(f"Summary: {row['summary']}")

    elif module == "project":
        parts.append(f"Project: {row.get('name', '')}")
        if row.get("description"):
            parts.append(f"Description: {row['description']}")

    elif module == "note":
        parts.append(f"Note: {row.get('content', '')}")
        parts.append(f"On: {row.get('entity_type', '')}/{row.get('entity_id', '')}")

    return "\n".join(parts)


def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Simple text chunking by character count with overlap."""
    if not text or len(text) <= chunk_size:
        return [text.strip()] if text else []

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        if end < len(text):
            for sep in (". ", "! ", "? ", "\n\n", "\n", " "):
                pos = text.rfind(sep, start, end)
                if pos > start:
                    end = pos + len(sep)
                    break
        chunks.append(text[start:end].strip())
        next_start = end - overlap
        if next_start <= start:
            next_start = start + 1
        start = next_start
    return chunks


# ---------------------------------------------------------------------------
# Re-indexer
# ---------------------------------------------------------------------------


async def reindex_tenant(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    workspace_id: UUID | None = None,
    source_modules: list[str] | None = None,
) -> dict[str, Any]:
    """Bulk re-index all CRM entities for a tenant into the vector store.

    Returns a summary dict with counts per module.
    """
    now = datetime.now(timezone.utc)
    stats: dict[str, Any] = {"total_docs": 0, "total_chunks": 0}
    module_summary: dict[str, int] = {}

    # ── Process each entity type ───────────────────────────────────
    for module_name, source_table, query_sql in ENTITY_QUERIES:
        if source_modules and module_name not in source_modules:
            continue

        result = await db.execute(text(query_sql), {"tenant_id": tenant_id})
        rows = result.mappings().fetchall()
        if not rows:
            continue

        module_count = 0
        for row in rows:
            row_dict = dict(row)
            source_record_id = row_dict["id"]
            text_content = _format_row(module_name, row_dict)
            if not text_content or len(text_content) < 20:
                continue

            chunks_text = _chunk_text(text_content)
            if not chunks_text:
                continue

            doc_id = uuid4()
            await db.execute(
                text("""
                    INSERT INTO nexus_ai.vector_documents
                        (id, tenant_id, workspace_id, team_id, owner_user_id,
                         visibility_scope, source_module, source_record_id, created_at)
                    VALUES
                        (:id, :tenant_id, :workspace_id, NULL, NULL,
                         'workspace', :source_module, :source_record_id, :created_at)
                    ON CONFLICT (id) DO UPDATE SET
                        source_module = EXCLUDED.source_module
                """),
                {
                    "id": doc_id,
                    "tenant_id": tenant_id,
                    "workspace_id": workspace_id or tenant_id,
                    "source_module": module_name,
                    "source_record_id": source_record_id,
                    "created_at": now,
                },
            )

            # Generate embeddings one at a time (avoid batching issues)
            vectors: list[list[float]] = []
            for ct in chunks_text:
                vec = await embed_query(ct)
                vectors.append(vec)

            for idx, (ctext, vec) in enumerate(zip(chunks_text, vectors)):
                chunk_id = uuid4()
                await db.execute(
                    text("""
                        INSERT INTO nexus_ai.vector_document_chunks
                            (id, document_id, chunk_text, embedding,
                             tenant_id, workspace_id, visibility_scope)
                        VALUES
                            (:id, :document_id, :chunk_text, :embedding::vector,
                             :tenant_id, :workspace_id, 'workspace')
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {
                        "id": chunk_id,
                        "document_id": doc_id,
                        "chunk_text": ctext,
                        "embedding": str(vec),
                        "tenant_id": tenant_id,
                        "workspace_id": workspace_id or tenant_id,
                    },
                )

            module_count += len(chunks_text)
            stats["total_docs"] += 1
            stats["total_chunks"] += len(chunks_text)

        module_summary[module_name] = module_count
        await db.commit()

    # ── Process notes separately ───────────────────────────────────
    if not source_modules or "note" in source_modules:
        notes_result = await db.execute(text(NOTES_QUERY), {"tenant_id": tenant_id})
        notes_rows = notes_result.mappings().fetchall()
        note_count = 0
        for row in notes_rows:
            row_dict = dict(row)
            text_content = _format_row("note", row_dict)
            if not text_content or len(text_content) < 20:
                continue

            chunks_text = _chunk_text(text_content)
            if not chunks_text:
                continue

            doc_id = uuid4()
            await db.execute(
                text("""
                    INSERT INTO nexus_ai.vector_documents
                        (id, tenant_id, workspace_id, team_id, owner_user_id,
                         visibility_scope, source_module, source_record_id, created_at)
                    VALUES
                        (:id, :tenant_id, :workspace_id, NULL, NULL,
                         'workspace', 'note', :source_record_id, :created_at)
                    ON CONFLICT (id) DO UPDATE SET
                        source_module = EXCLUDED.source_module
                """),
                {
                    "id": doc_id,
                    "tenant_id": tenant_id,
                    "workspace_id": workspace_id or tenant_id,
                    "source_record_id": row_dict["note_id"],
                    "created_at": now,
                },
            )

            for ct in chunks_text:
                vec = await embed_query(ct)
                chunk_id = uuid4()
                await db.execute(
                    text("""
                        INSERT INTO nexus_ai.vector_document_chunks
                            (id, document_id, chunk_text, embedding,
                             tenant_id, workspace_id, visibility_scope)
                        VALUES
                            (:id, :document_id, :chunk_text, :embedding::vector,
                             :tenant_id, :workspace_id, 'workspace')
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {
                        "id": chunk_id,
                        "document_id": doc_id,
                        "chunk_text": ct,
                        "embedding": str(vec),
                        "tenant_id": tenant_id,
                        "workspace_id": workspace_id or tenant_id,
                    },
                )

            note_count += len(chunks_text)
            stats["total_chunks"] += len(chunks_text)
            stats["total_docs"] += 1

        if note_count > 0:
            module_summary["note"] = note_count
            await db.commit()

    stats["modules"] = module_summary
    return stats


async def delete_tenant_vectors(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    source_modules: list[str] | None = None,
) -> int:
    """Delete all vector data for a tenant (or specific modules)."""
    if source_modules:
        result = await db.execute(
            text("""
                DELETE FROM nexus_ai.vector_document_chunks
                WHERE tenant_id = :tenant_id
                  AND document_id IN (
                      SELECT id FROM nexus_ai.vector_documents
                      WHERE tenant_id = :tenant_id
                        AND source_module = ANY(:modules)
                  )
            """),
            {"tenant_id": tenant_id, "modules": source_modules},
        )
        chunk_count = result.rowcount
        result = await db.execute(
            text("""
                DELETE FROM nexus_ai.vector_documents
                WHERE tenant_id = :tenant_id
                  AND source_module = ANY(:modules)
            """),
            {"tenant_id": tenant_id, "modules": source_modules},
        )
        doc_count = result.rowcount
    else:
        result = await db.execute(
            text("DELETE FROM nexus_ai.vector_document_chunks WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        chunk_count = result.rowcount
        result = await db.execute(
            text("DELETE FROM nexus_ai.vector_documents WHERE tenant_id = :tenant_id"),
            {"tenant_id": tenant_id},
        )
        doc_count = result.rowcount

    await db.commit()
    return chunk_count + doc_count
