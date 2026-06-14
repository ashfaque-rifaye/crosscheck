"""Prompts for the two LLM reasoning steps: claim extraction and contradiction
detection. Both demand strict JSON so the pipeline can parse deterministically.
"""
from __future__ import annotations

from backend.models import Claim, Passage

CLAIM_SYSTEM = (
    "You are a meticulous enterprise-knowledge analyst. You extract atomic, "
    "normalized factual claims from documents. A claim is a single checkable "
    "assertion: a rule, requirement, numeric value, or stated behavior. Stay "
    "strictly faithful to the text — never infer beyond what is written. "
    "Respond with JSON only."
)

CONFLICT_SYSTEM = (
    "You detect genuine contradictions between claims that come from different "
    "enterprise documents. A contradiction is two claims about the SAME subject "
    "and SAME scope that cannot both be true at the same time. Do NOT flag claims "
    "that merely overlap, restate each other, or apply to different scopes or "
    "subjects (those are agreements, not conflicts). Every contradiction must "
    "involve two claims whose source documents differ. Respond with JSON only."
)


def claim_extraction_user(passages: list[Passage]) -> str:
    lines = [
        "Extract the atomic claims from the passages below.",
        "",
        "For each claim return:",
        '  - passage_index: the [n] of the passage it came from',
        '  - subject: a short normalized topic (e.g. "password rotation period", '
        '"API rate limit", "refund window"). Use IDENTICAL wording for claims about '
        "the same thing so comparable claims can be matched.",
        "  - assertion: one plain sentence stating the claim",
        '  - value: the salient value if any (e.g. "90 days", "never", "required", '
        '"99.9%", "60 rps"); use "" if none',
        '  - conditions: any scope or conditions it applies under; use "" if none',
        "",
        'Return JSON: {"claims": [{"passage_index": 0, "subject": "...", '
        '"assertion": "...", "value": "...", "conditions": "..."}]}',
        "",
        "Passages:",
    ]
    for i, p in enumerate(passages):
        sr = p.source_ref
        lines.append(
            f'[{i}] source="{sr.source_name}" ({sr.source_type.value}) '
            f'section="{sr.locator}"'
        )
        lines.append(p.text.strip())
        lines.append("")
    return "\n".join(lines)


def contradiction_user(claims: list[Claim]) -> str:
    lines = [
        "Below are claims extracted from several documents. Identify every genuine "
        "contradiction between claims from DIFFERENT sources.",
        "",
        "For each contradiction return:",
        "  - claim_a_id and claim_b_id: the two conflicting claims (different sources)",
        "  - type: one of direct-negation | numeric-mismatch | "
        "scope-condition-mismatch | temporal-outdated",
        "  - severity: high | medium | low (high when it affects security, "
        "legal/contractual terms, data safety, or customer-facing commitments)",
        "  - confidence: 0.0-1.0",
        '  - title: a short label, e.g. "Password rotation: every 90 days vs never expires"',
        "  - explanation: one or two sentences on why the two claims conflict",
        "",
        'Return JSON: {"conflicts": [{"claim_a_id": "c0", "claim_b_id": "c1", '
        '"type": "...", "severity": "...", "confidence": 0.9, "title": "...", '
        '"explanation": "..."}]}',
        "If there are no genuine contradictions, return {\"conflicts\": []}.",
        "",
        "Claims:",
    ]
    for c in claims:
        sr = c.source_ref
        val = f' value="{c.value}"' if c.value else ""
        cond = f' conditions="{c.conditions}"' if c.conditions else ""
        lines.append(
            f'[{c.id}] subject="{c.subject}"{val} assertion="{c.assertion}"{cond} '
            f'(source: {sr.source_name}, {sr.source_type.value})'
        )
    return "\n".join(lines)
