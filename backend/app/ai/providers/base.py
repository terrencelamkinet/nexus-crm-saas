"""
Provider abstraction layer — Protocol + shared types.

Every LLM provider adapter must conform to ``AIProviderAdapter``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Shared types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderResponse:
    """Normalised response from any LLM provider adapter."""

    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_estimate: float = 0.0
    model_used: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    """Base exception for provider-level failures (auth, rate-limit, etc.)."""

    def __init__(
        self,
        message: str,
        provider: str = "",
        status_code: int = 500,
        raw_error: str = "",
    ) -> None:
        self.provider = provider
        self.status_code = status_code
        self.raw_error = raw_error
        super().__init__(f"[{provider}] {message}")


# ---------------------------------------------------------------------------
# Provider adapter protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class AIProviderAdapter(Protocol):
    """Interface that every LLM provider adapter must satisfy."""

    provider_name: str

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str = "",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        **kwargs: Any,
    ) -> ProviderResponse:
        """Send a chat completion request and return the parsed response."""
        ...

    async def embed(
        self,
        texts: list[str],
        model: str = "",
        **kwargs: Any,
    ) -> list[list[float]]:
        """Generate embeddings for a batch of text inputs."""
        ...

    async def health_check(self, **kwargs: Any) -> bool:
        """Return True if the provider is reachable and authenticating OK."""
        ...
