"""Knowledge-retrieval provider interface.

Crosscheck reads all knowledge through this one boundary, so the reasoning
engine is identical whether passages come from the local mock corpus or a real
Foundry IQ knowledge base. Swap implementations via the PROVIDER env var.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from backend.models import Passage, SourceRef


class KnowledgeProvider(ABC):
    label: str = "base"

    @abstractmethod
    def search(self, query: str, top: int = 12) -> list[Passage]:
        """Return passages relevant to ``query``, each carrying a SourceRef citation."""

    @abstractmethod
    def all_passages(self, cap: int = 200) -> list[Passage]:
        """Return a broad sweep of passages across all sources (used by full-scan)."""

    def sources(self) -> list[SourceRef]:
        """Distinct source documents known to this provider."""
        seen: dict[str, SourceRef] = {}
        for p in self.all_passages():
            seen.setdefault(p.source_ref.source_id, p.source_ref)
        return list(seen.values())
