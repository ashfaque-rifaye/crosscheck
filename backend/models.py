"""Domain models for Crosscheck.

The data flows: Passage (retrieved) -> Claim (extracted) -> Conflict (detected)
-> Report (ranked + summarized). Every Claim and every side of a Conflict carries
a SourceRef so the output is always traceable to source material.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    policy = "policy"
    onboarding = "onboarding"
    runbook = "runbook"
    architecture = "architecture"
    pricing = "pricing"
    contract = "contract"
    api_spec = "api_spec"
    changelog = "changelog"
    wiki = "wiki"
    other = "other"


class ConflictType(str, Enum):
    direct_negation = "direct-negation"
    numeric_mismatch = "numeric-mismatch"
    scope_condition = "scope-condition-mismatch"
    temporal_outdated = "temporal-outdated"


class Severity(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


# Severity ordering for deterministic ranking (higher = more severe).
SEVERITY_RANK = {Severity.high: 3, Severity.medium: 2, Severity.low: 1}


class SourceRef(BaseModel):
    """Locates a piece of content back to its origin document."""

    source_id: str
    source_name: str
    source_type: SourceType = SourceType.other
    locator: str = ""  # e.g. "§2.1" or "Password rotation"
    version: Optional[str] = None
    effective_date: Optional[str] = None  # ISO date string; used for resolution heuristics
    precedence: int = 0  # higher = more authoritative (e.g. signed contract > wiki)


class Passage(BaseModel):
    """A retrieved unit of content with its citation."""

    id: str
    text: str
    source_ref: SourceRef
    score: float = 0.0


class Claim(BaseModel):
    """An atomic, normalized assertion extracted from a passage."""

    id: str
    subject: str            # what the claim is about, e.g. "password rotation period"
    assertion: str          # the normalized statement
    value: Optional[str] = None  # the salient value, e.g. "90 days", "never", "required"
    conditions: Optional[str] = None  # scope/conditions under which it holds
    source_ref: SourceRef
    passage_id: str


class ConflictSide(BaseModel):
    """One side of a contradiction: a claim and where it came from."""

    statement: str
    value: Optional[str] = None
    source_ref: SourceRef


class Conflict(BaseModel):
    """A detected contradiction between two cited claims."""

    id: str
    topic: str
    title: str
    type: ConflictType
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    explanation: str
    side_a: ConflictSide
    side_b: ConflictSide
    suggested_resolution: Optional[str] = None
    resolution_basis: Optional[str] = None  # the heuristic used; a SUGGESTION, not ground truth

    def distinct_sources(self) -> int:
        return len({self.side_a.source_ref.source_id, self.side_b.source_ref.source_id})


class TraceStep(BaseModel):
    """A single step in the visible reasoning trace."""

    step: str
    detail: str = ""
    status: str = "done"  # running | done


class ReportSummary(BaseModel):
    sources_scanned: int = 0
    passages_retrieved: int = 0
    claims_extracted: int = 0
    conflicts_found: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0


class Report(BaseModel):
    query: str
    mode: str                 # "topic" | "full-scan"
    provider: str             # "Mock corpus" | "Foundry IQ"
    llm_mode: str             # "azure" | "openai" | "offline"
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    summary: ReportSummary = Field(default_factory=ReportSummary)
    conflicts: list[Conflict] = Field(default_factory=list)
    trace: list[TraceStep] = Field(default_factory=list)
    note: Optional[str] = None  # e.g. "No contradictions found" or offline-demo notice
