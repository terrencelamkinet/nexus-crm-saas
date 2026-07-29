"""Gemini provider adapter — google-genai SDK v2.

Registered as ``"gemini"``.
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any, AsyncIterator, Optional

from google import genai
from google.genai import types as genai_types

from app.ai.providers.base import (
    ProviderAdapter,
    UsageReport,
    compute_cost,
    register_provider,
)

_GEMINI_COST_CARDS: dict[str, tuple[Decimal, Decimal, Decimal]] = {
    "gemini-2.0-flash":         (Decimal("0.00010"), Decimal("0.00040"), Decimal("0")),
    "gemini-2.0-flash-lite":    (Decimal("0.000075"), Decimal("0.00030"), Decimal("0")),
    "gemini-2.5-pro":           (Decimal("0.00125"), Decimal("0.01000"), Decimal("0")),
    "gemini-2.5-flash":         (Decimal("0.00015"), Decimal("0.00060"), Decimal("0")),
    "gemini-1.5-pro":           (Decimal("0.00125"), Decimal("0.00500"), Decimal("0")),
    "gemini-1.5-flash":         (Decimal("0.000075"), Decimal("0.00030"), Decimal("0")),
}

_GEMINI_EMBEDDING_MODELS = {"text-embedding-004", "embedding-001"}


@register_provider("gemini")
class GeminiAdapter(ProviderAdapter):
    """Adapter for Google Gemini models via google-genai SDK v2."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: str = "gemini-2.0-flash",
    ) -> None:
        self._client = genai.Client(api_key=api_key or os.environ.get("GEMINI_API_KEY", ""))
        self._default_model = default_model

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> tuple[str, UsageReport]:
        resolved = model or self._default_model

        # Convert OpenAI-style messages to Gemini content list
        contents = _to_gemini_contents(messages)

        kwargs: dict[str, Any] = dict(
            model=resolved,
            contents=contents,
            config=genai_types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )

        response = self._client.models.generate_content(**kwargs)
        text = response.text or ""

        usage = response.usage_metadata
        report = UsageReport(
            input_tokens=usage.prompt_token_count if usage else 0,
            output_tokens=usage.candidates_token_count if usage else 0,
            cost_usd=_gemini_cost(resolved, usage),
            model=resolved,
            provider="gemini",
        )
        return text, report

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        model: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncIterator[tuple[str, UsageReport]]:
        resolved = model or self._default_model
        contents = _to_gemini_contents(messages)

        stream = self._client.models.generate_content_stream(
            model=resolved,
            contents=contents,
            config=genai_types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=max_tokens,
            ),
        )

        final_usage = None
        for chunk in stream:
            if chunk.text:
                yield chunk.text, UsageReport()
            if chunk.usage_metadata:
                final_usage = chunk.usage_metadata

        report = UsageReport(
            input_tokens=final_usage.prompt_token_count if final_usage else 0,
            output_tokens=final_usage.candidates_token_count if final_usage else 0,
            cost_usd=_gemini_cost(resolved, final_usage),
            model=resolved,
            provider="gemini",
        )
        yield "", report

    # ------------------------------------------------------------------
    # Embed
    # ------------------------------------------------------------------

    async def embed(
        self,
        texts: list[str],
        model: str = "text-embedding-004",
    ) -> tuple[list[list[float]], UsageReport]:
        result = self._client.models.embed_content(
            model=model or "text-embedding-004",
            contents=texts,
        )
        vectors = [e.values for e in result.embeddings]
        report = UsageReport(
            input_tokens=sum(len(t.split()) for t in texts),
            model=model,
            provider="gemini",
        )
        return vectors, report


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _to_gemini_contents(messages: list[dict[str, Any]]) -> list[genai_types.Content]:
    """Convert OpenAI-format messages to Gemini Content list."""
    role_map = {"user": "user", "assistant": "model", "system": "user"}
    contents: list[genai_types.Content] = []
    for msg in messages:
        role = role_map.get(msg.get("role", "user"), "user")
        content = msg.get("content", "")
        if not content:
            continue
        # Prepend "System: " for system messages so Gemini understands
        prefix = "System instruction: " if msg.get("role") == "system" else ""
        contents.append(genai_types.Content(
            role=role,
            parts=[genai_types.Part(text=prefix + content)],
        ))
    return contents


def _gemini_cost(model: str, usage: Any) -> Decimal:
    """Compute Gemini cost from usage_metadata."""
    if usage is None:
        return Decimal("0")
    card = _GEMINI_COST_CARDS.get(model)
    if card is None:
        # Linear search fallback
        for key, c in _GEMINI_COST_CARDS.items():
            if model.startswith(key):
                card = c
                break
    if card is None:
        return Decimal("0")

    inp = usage.prompt_token_count or 0
    out = usage.candidates_token_count or 0
    total = (inp * card[0] + out * card[1]) / Decimal("1000")
    return total.quantize(Decimal("0.000001"))
