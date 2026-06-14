"""Foundry IQ provider — the real Microsoft IQ integration.

Retrieves grounded, cited passages from a Foundry IQ *knowledge base* using
Azure AI Search **agentic retrieval**. The knowledge base decomposes the query
into parallel subqueries across its knowledge sources, semantically reranks, and
returns extractive content with references — exactly the multi-source, cited
grounding Crosscheck needs to find and prove contradictions.

Auth: API key (the ``api-key`` header). The agentic-retrieval API is in preview
and its exact path/version can change — set AZURE_SEARCH_RETRIEVE_URL to the
exact URL from your Foundry IQ portal if the default below doesn't match. The
response parser is deliberately defensive about field names for the same reason.

Docs: https://learn.microsoft.com/azure/search/agentic-retrieval-overview
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from backend.config import Settings
from backend.models import Passage, SourceRef, SourceType
from backend.providers.base import KnowledgeProvider

# Broad seed queries used to approximate a "full scan" over a query-driven
# agentic-retrieval API (which has no native "return everything" call).
_SEED_QUERIES = [
    "password rotation and authentication and MFA requirements",
    "database operations, restarts, failover and backups",
    "pricing, refunds, billing and uptime SLA commitments",
    "API rate limits and authentication headers",
    "data retention, security and compliance policies",
]


def _as_dict(value: Any) -> dict:
    """sourceData may arrive as a dict or a JSON string."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {"content": value}
        except json.JSONDecodeError:
            return {"content": value}
    return {}


def _first(d: dict, *keys: str, default: str = "") -> str:
    for k in keys:
        v = d.get(k)
        if v:
            return str(v)
    return default


class FoundryIQProvider(KnowledgeProvider):
    label = "Foundry IQ"

    def __init__(self, settings: Settings):
        self.settings = settings
        if not settings.azure_search_endpoint or not settings.azure_search_api_key:
            raise RuntimeError(
                "Foundry IQ is selected (PROVIDER=foundry) but AZURE_SEARCH_ENDPOINT / "
                "AZURE_SEARCH_API_KEY are not set. Fill them in .env or switch PROVIDER=mock."
            )
        self.retrieve_url = settings.azure_search_retrieve_url or (
            f"{settings.azure_search_endpoint.rstrip('/')}"
            f"/knowledgeBases/{settings.azure_search_knowledge_base}/retrieve"
            f"?api-version={settings.azure_search_api_version}"
        )

    # ----------------------------------------------------------------- #
    def _retrieve(self, query: str, top: int) -> list[Passage]:
        body = {
            "messages": [{"role": "user", "content": [{"type": "text", "text": query}]}],
            "knowledgeSourceParams": [{"top": top}],
        }
        headers = {"api-key": self.settings.azure_search_api_key, "Content-Type": "application/json"}
        with httpx.Client(timeout=30) as client:
            resp = client.post(self.retrieve_url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
        return self._parse(data, query, top)

    def _parse(self, data: dict, query: str, top: int) -> list[Passage]:
        passages: list[Passage] = []
        refs = data.get("references") or data.get("citations") or []
        for i, ref in enumerate(refs):
            sd = _as_dict(ref.get("sourceData") or ref.get("source_data") or ref)
            text = _first(sd, "content", "text", "chunk", "snippet")
            if not text:
                continue
            source_name = _first(
                sd, "source_name", "title", "source", "filepath", "filename",
                default=str(ref.get("docKey") or ref.get("id") or f"source-{i}"),
            )
            locator = _first(sd, "section", "header", "locator", "page")
            passages.append(
                Passage(
                    id=str(ref.get("docKey") or ref.get("id") or f"ref-{i}"),
                    text=text.strip(),
                    source_ref=SourceRef(
                        source_id=_first(sd, "source_id", "source", default=source_name),
                        source_name=source_name,
                        source_type=_coerce_type(_first(sd, "source_type", "type")),
                        locator=locator,
                        version=_first(sd, "version") or None,
                        effective_date=_first(sd, "effective_date", "date", "modified") or None,
                        precedence=int(sd.get("precedence") or 0) if str(sd.get("precedence", "")).isdigit() else 0,
                    ),
                    score=float(ref.get("rerankerScore") or ref.get("score") or 0.0),
                )
            )
        return passages[:top]

    # ----------------------------------------------------------------- #
    def search(self, query: str, top: int = 12) -> list[Passage]:
        return self._retrieve(query, top)

    def all_passages(self, cap: int = 200) -> list[Passage]:
        seen: dict[str, Passage] = {}
        for q in _SEED_QUERIES:
            for p in self._retrieve(q, top=8):
                seen.setdefault(p.id, p)
            if len(seen) >= cap:
                break
        return list(seen.values())[:cap]


def _coerce_type(raw: str) -> SourceType:
    try:
        return SourceType(raw)
    except ValueError:
        return SourceType.other
