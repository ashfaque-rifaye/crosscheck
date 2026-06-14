"""Local mock provider.

Reads the bundled ``corpus/`` of synthetic markdown documents, splits each into
section-level passages, and does lightweight keyword retrieval. The corpus
intentionally contains planted contradictions so the reasoning engine has real
conflicts to find — with no cloud dependency.
"""
from __future__ import annotations

import re
from pathlib import Path

from backend.config import CORPUS_DIR
from backend.models import Passage, SourceRef, SourceType
from backend.providers.base import KnowledgeProvider

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "of", "to", "and", "or", "in", "on", "for", "is", "are",
    "be", "with", "by", "policy", "about", "what", "which", "our", "your",
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _parse_frontmatter(raw: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(raw)
    if not m:
        return {}, raw
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip().strip('"').strip("'")
    return meta, raw[m.end():]


def _split_sections(body: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, str]] = []
    head, buf = "Overview", []
    for line in body.splitlines():
        if line.startswith("## "):
            if buf:
                sections.append((head, "\n".join(buf).strip()))
            head, buf = line[3:].strip(), []
        elif line.startswith("# "):
            continue  # document title
        else:
            buf.append(line)
    if buf:
        sections.append((head, "\n".join(buf).strip()))
    return [(h, t) for h, t in sections if t]


def _load_doc(path: Path) -> list[Passage]:
    meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
    try:
        source_type = SourceType(meta.get("source_type", "other"))
    except ValueError:
        source_type = SourceType.other
    base = dict(
        source_id=meta.get("source_id", path.stem),
        source_name=meta.get("source_name", path.stem),
        source_type=source_type,
        version=meta.get("version") or None,
        effective_date=meta.get("effective_date") or None,
        precedence=int(meta.get("precedence") or 0),
    )
    passages: list[Passage] = []
    for head, text in _split_sections(body):
        ref = SourceRef(locator=head, **base)
        passages.append(Passage(id=f"{base['source_id']}::{_slug(head)}", text=text, source_ref=ref))
    return passages


class MockProvider(KnowledgeProvider):
    label = "Mock corpus"

    def __init__(self, corpus_dir: Path | None = None):
        self.corpus_dir = corpus_dir or CORPUS_DIR
        self._passages = self._load()

    def _load(self) -> list[Passage]:
        out: list[Passage] = []
        for path in sorted(self.corpus_dir.glob("*.md")):
            out.extend(_load_doc(path))
        return out

    def search(self, query: str, top: int = 12) -> list[Passage]:
        q = {t for t in _TOKEN_RE.findall(query.lower()) if t not in _STOPWORDS}
        if not q:
            return self.all_passages(cap=top)
        scored: list[tuple[float, Passage]] = []
        for p in self._passages:
            hay = f"{p.text} {p.source_ref.source_name} {p.source_ref.locator}".lower()
            toks = _TOKEN_RE.findall(hay)
            tokset = set(toks)
            overlap = sum(1 for t in q if t in tokset)
            if not overlap:
                continue
            score = overlap + 0.1 * sum(toks.count(t) for t in q)
            scored.append((score, p))
        scored.sort(key=lambda x: (-x[0], x[1].id))
        return [p.model_copy(update={"score": round(float(s), 3)}) for s, p in scored[:top]]

    def all_passages(self, cap: int = 200) -> list[Passage]:
        return [p.model_copy() for p in self._passages[:cap]]
