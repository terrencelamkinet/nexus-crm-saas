"""
FastAPI middleware that builds AISessionContext for every /api/v1/ai/ request.

Only triggers on AI-prefixed paths.  Sets request.state.ai_context,
request.state.workspace_id, and request.state.team_ids so downstream
route handlers and services can access them without re-resolving.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.session.context import AISessionContext, build_ai_session_context
from app.db import async_session


class AISessionMiddleware(BaseHTTPMiddleware):
    """Populates request state with AI session context for AI endpoints.

    Only activates on paths starting with ``/api/v1/ai/``.
    """

    AI_PREFIX = "/api/v1/ai/"

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not request.url.path.startswith(self.AI_PREFIX):
            return await call_next(request)

        # /api/v1/ai/health is public — no auth, no session context
        if request.url.path == "/api/v1/ai/health":
            return await call_next(request)

        async with async_session() as db:
            ctx: AISessionContext = await build_ai_session_context(request, db)

            # Attach the full context object
            request.state.ai_context = ctx

            # Attach individual fields for convenience / backward compat
            request.state.workspace_id = ctx.workspace_id
            request.state.team_ids = (
                [ctx.team_id]
                if ctx.team_id is not None
                else []
            )

            response: Response = await call_next(request)

        return response
