"""The Crosscheck reasoning pipeline.

Multi-step, provider-agnostic flow:
    retrieve -> extract claims -> cluster by subject -> detect contradictions
    -> ground/guardrail -> rank -> summarize.

Every emitted conflict is grounded: it requires two claims from two DIFFERENT
source documents, each carrying a citation derived from a retrieved passage.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from backend.config import SAMPLES_DIR, Settings, get_settings
from backend.models import (
    SEVERITY_RANK,
    Claim,
    Conflict,
    ConflictSide,
    ConflictType,
    Passage,
    Report,
    ReportSummary,
    Severity,
    TraceStep,
)
from backend.providers.base import KnowledgeProvider
from backend.reasoning.llm import LLMClient, get_llm_client
from backend.reasoning.prompts import (
    CLAIM_SYSTEM,
    CONFLICT_SYSTEM,
    claim_extraction_user,
    contradiction_user,
)


# --------------------------------------------------------------------------- #
# Provider factory
# --------------------------------------------------------------------------- #
def get_provider(settings: Settings) -> KnowledgeProvider:
    if settings.provider.lower() == "foundry":
        from backend.providers.foundry_provider import FoundryIQProvider

        return FoundryIQProvider(settings)
    from backend.providers.mock_provider import MockProvider

    return MockProvider()


# --------------------------------------------------------------------------- #
# Reasoning steps
# --------------------------------------------------------------------------- #
def _extract_claims(llm: LLMClient, passages: list[Passage]) -> list[Claim]:
    data = llm.chat_json(CLAIM_SYSTEM, claim_extraction_user(passages))
    claims: list[Claim] = []
    for i, raw in enumerate(data.get("claims", [])):
        pi = raw.get("passage_index")
        if not isinstance(pi, int) or not (0 <= pi < len(passages)):
            continue
        p = passages[pi]
        claims.append(
            Claim(
                id=f"c{i}",
                subject=(raw.get("subject") or "claim").strip(),
                assertion=(raw.get("assertion") or p.text[:160]).strip(),
                value=(raw.get("value") or None),
                conditions=(raw.get("conditions") or None),
                source_ref=p.source_ref,
                passage_id=p.id,
            )
        )
    return claims


def _norm_subject(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _cluster_count(claims: list[Claim]) -> int:
    return len({_norm_subject(c.subject) for c in claims})


def _suggest_resolution(a: Claim, b: Claim) -> tuple[Optional[str], Optional[str]]:
    """A SUGGESTED tie-breaker — never asserted as ground truth.

    Prefers the higher-authority source; falls back to the more recent one.
    """
    ra, rb = a.source_ref, b.source_ref
    if ra.precedence != rb.precedence:
        win, lose = (a, b) if ra.precedence > rb.precedence else (b, a)
        basis = (
            f"Authority: {win.source_ref.source_name} (precedence "
            f"{win.source_ref.precedence}) outranks {lose.source_ref.source_name} "
            f"(precedence {lose.source_ref.precedence})."
        )
        return f'Treat "{win.source_ref.source_name}" as authoritative.', basis
    if ra.effective_date and rb.effective_date and ra.effective_date != rb.effective_date:
        win, lose = (a, b) if ra.effective_date > rb.effective_date else (b, a)
        basis = (
            f"Recency: {win.source_ref.source_name} ({win.source_ref.effective_date}) "
            f"supersedes {lose.source_ref.source_name} ({lose.source_ref.effective_date})."
        )
        return f'Prefer the more recent "{win.source_ref.source_name}".', basis
    return None, None


def _build_conflict(idx: int, raw: dict, by_id: dict[str, Claim], topic: str) -> Optional[Conflict]:
    a = by_id.get(raw.get("claim_a_id", ""))
    b = by_id.get(raw.get("claim_b_id", ""))
    if not a or not b:
        return None
    # Grounding guardrail: a contradiction needs two DISTINCT source documents.
    if a.source_ref.source_id == b.source_ref.source_id:
        return None
    try:
        ctype = ConflictType(raw.get("type"))
    except ValueError:
        ctype = ConflictType.direct_negation
    try:
        severity = Severity(raw.get("severity"))
    except ValueError:
        severity = Severity.medium
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0.6))))
    except (TypeError, ValueError):
        confidence = 0.6
    resolution, basis = _suggest_resolution(a, b)
    return Conflict(
        id=f"k{idx}",
        topic=topic,
        title=(raw.get("title") or a.subject).strip(),
        type=ctype,
        severity=severity,
        confidence=confidence,
        explanation=(raw.get("explanation") or "").strip(),
        side_a=ConflictSide(statement=a.assertion, value=a.value, source_ref=a.source_ref),
        side_b=ConflictSide(statement=b.assertion, value=b.value, source_ref=b.source_ref),
        suggested_resolution=resolution,
        resolution_basis=basis,
    )


def _rank(conflicts: list[Conflict]) -> list[Conflict]:
    return sorted(
        conflicts,
        key=lambda c: (-SEVERITY_RANK[c.severity], -c.confidence, c.id),
    )


def _summarize(conflicts: list[Conflict], sources: int, passages: int, claims: int) -> ReportSummary:
    return ReportSummary(
        sources_scanned=sources,
        passages_retrieved=passages,
        claims_extracted=claims,
        conflicts_found=len(conflicts),
        high=sum(c.severity == Severity.high for c in conflicts),
        medium=sum(c.severity == Severity.medium for c in conflicts),
        low=sum(c.severity == Severity.low for c in conflicts),
    )


# --------------------------------------------------------------------------- #
# Offline fallback (no LLM configured): serve the bundled cached report
# --------------------------------------------------------------------------- #
def _offline_report(query: str, mode: str, settings: Settings) -> Report:
    cache = SAMPLES_DIR / "cached_report.json"
    if not cache.exists():
        return Report(
            query=query,
            mode=mode,
            provider=settings.provider_label,
            llm_mode="offline",
            note=(
                "Offline demo: no LLM configured and no cached report found. "
                "Add AZURE_OPENAI_* (or OPENAI_API_KEY) to .env to run live reasoning."
            ),
            trace=[TraceStep(step="Offline mode", detail="No LLM configured.")],
        )
    report = Report.model_validate_json(cache.read_text(encoding="utf-8"))
    report.query, report.mode, report.llm_mode = query, mode, "offline"
    report.provider = settings.provider_label
    if mode == "topic" and query.strip():
        terms = {t for t in _norm_subject(query).split() if len(t) > 2}
        if terms:
            filtered = [
                c for c in report.conflicts
                if terms & set(_norm_subject(
                    f"{c.title} {c.explanation} {c.side_a.source_ref.source_name} "
                    f"{c.side_b.source_ref.source_name}"
                ).split())
            ]
            if filtered:
                report.conflicts = _rank(filtered)
    report.summary = _summarize(
        report.conflicts,
        report.summary.sources_scanned,
        report.summary.passages_retrieved,
        report.summary.claims_extracted,
    )
    report.note = "Offline demo — replaying the bundled cached report (no live LLM call)."
    if not any(t.step.startswith("Offline") for t in report.trace):
        report.trace.append(TraceStep(step="Offline mode", detail="Replayed cached report."))
    return report


def _offline_with_error(query: str, mode: str, settings: Settings, err: Exception) -> Report:
    """When a live LLM call fails, degrade gracefully to the cached report."""
    report = _offline_report(query, mode, settings)
    report.note = (
        f"Live reasoning call failed ({type(err).__name__}); showing the cached "
        f"report instead. Detail: {err}"
    )
    return report


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
def run_audit(query: str, mode: str = "topic", settings: Optional[Settings] = None) -> Report:
    settings = settings or get_settings()
    provider = get_provider(settings)
    trace: list[TraceStep] = []

    # 1. Retrieve
    if mode == "full-scan":
        passages = provider.all_passages(cap=settings.max_passages)
    else:
        passages = provider.search(query, top=min(12, settings.max_passages))
    source_names = sorted({p.source_ref.source_name for p in passages})
    retrieve_detail = f"{len(passages)} passages across {len(source_names)} sources"
    if settings.provider.lower() == "foundry":
        retrieve_detail += " — Foundry IQ agentic retrieval ran parallel subqueries"
    trace.append(TraceStep(step=f"Retrieve via {provider.label}", detail=retrieve_detail))

    if not passages:
        return Report(
            query=query, mode=mode, provider=settings.provider_label,
            llm_mode=settings.llm_mode, trace=trace,
            note="No matching content found for this topic.",
        )

    # Offline path
    if settings.llm_mode == "offline":
        return _offline_report(query, mode, settings)

    llm = get_llm_client(settings)
    if llm is None:  # safety net
        return _offline_report(query, mode, settings)

    try:
        # 2. Extract claims
        claims = _extract_claims(llm, passages)
        trace.append(
            TraceStep(step="Extract claims", detail=f"{len(claims)} atomic claims extracted")
        )

        # 3. Cluster by subject (the LLM compares within these groups)
        trace.append(
            TraceStep(step="Cluster by subject", detail=f"{_cluster_count(claims)} comparable topics")
        )

        # 4. Detect contradictions
        by_id = {c.id: c for c in claims}
        raw_conflicts = llm.chat_json(
            CONFLICT_SYSTEM, contradiction_user(claims)
        ).get("conflicts", [])
    except Exception as err:  # network/auth/quota — fall back, never hard-crash the demo
        return _offline_with_error(query, mode, settings, err)
    conflicts: list[Conflict] = []
    for i, raw in enumerate(raw_conflicts):
        c = _build_conflict(i, raw, by_id, query if mode == "topic" else "full-scan")
        if c:
            conflicts.append(c)
    dropped = len(raw_conflicts) - len(conflicts)
    detail = f"{len(conflicts)} grounded contradictions"
    if dropped > 0:
        detail += f" ({dropped} dropped by the 2-source grounding guardrail)"
    trace.append(TraceStep(step="Detect contradictions", detail=detail))

    # 5. Rank + summarize
    conflicts = _rank(conflicts)
    trace.append(TraceStep(step="Rank by severity & confidence", detail="ordered most-critical first"))

    report = Report(
        query=query,
        mode=mode,
        provider=settings.provider_label,
        llm_mode=settings.llm_mode,
        summary=_summarize(conflicts, len(source_names), len(passages), len(claims)),
        conflicts=conflicts,
        trace=trace,
    )
    if not conflicts:
        report.note = "No contradictions found across the retrieved sources."
    return report
