# ⚖️ Crosscheck — Enterprise Knowledge Contradiction Auditor

> **Find where your sources disagree.**
> A reasoning agent that audits a body of enterprise knowledge and surfaces the
> *contradictions* between authoritative documents — citing both sides, classifying
> the clash, and ranking by severity.

**Microsoft Agents League Hackathon** · Track: **🧠 Reasoning Agents** · Tool:
**Microsoft Foundry** · IQ layer: **Foundry IQ**

---

## The problem

Ordinary RAG answers a question from **one** retrieved passage. If two of your
documents quietly disagree — a security policy says rotate passwords every 90 days
while the onboarding guide says they never expire — RAG grounds in whichever one it
happened to fetch and answers *confidently and wrong*. The contradiction is invisible.

That silent disagreement is the root cause of untrustworthy enterprise agents.

## What Crosscheck does

Crosscheck does the **inverse of RAG**. Instead of answering, it audits:

1. Retrieves passages **across many sources** (via Foundry IQ).
2. Extracts atomic, normalized **claims**.
3. **Clusters** claims by subject and detects **contradictions** between sources.
4. Emits a ranked **Contradiction Report** — each conflict shows both claims, **both
   citations**, the conflict *type*, a *severity*, a *confidence*, and a clearly-labelled
   *suggested resolution*.

It refuses to assert a contradiction it can't prove: **no conflict is emitted without two
citations from two different source documents.**

A built-in **conflict map** turns the result into a picture — each source document is a node,
each contradiction an arc colored by severity and weighted by confidence — so you can see the
shape of disagreement at a glance and click any arc to jump to its details.

> _Run it and open <http://127.0.0.1:8000> to see the live UI — animated reasoning trace,
> summary stats, severity filters, and side-by-side cited conflict cards._
<!-- Add a screenshot at docs/screenshot.png and embed it here for the submission. -->

---

## Run it in 60 seconds (no cloud needed)

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --port 8000
```

Open <http://127.0.0.1:8000>, type a topic (e.g. **password policy**, **refund window**,
**API rate limit**) or hit **Full scan**. With no credentials it runs in **offline demo**
mode over a bundled cached report, so the UI always works.

- **Add live reasoning:** put `AZURE_OPENAI_*` (or `OPENAI_API_KEY`) in `.env` — the engine
  now extracts claims and detects contradictions with an LLM over the synthetic corpus.
- **Add real Foundry IQ:** check access (`./infra/check_access.ps1`), provision +
  upload the bundled corpus (`./infra/setup_foundry_iq.ps1`), create the knowledge base, then
  set `PROVIDER=foundry`. Citations now resolve to a real Foundry IQ knowledge base.

> **"My Azure is empty — how do I validate?"** That's expected. Crosscheck brings its own data:
> `setup_foundry_iq.ps1` uploads `corpus/` for you, and the knowledge base is built over it. The
> in-app **Setup & access** panel (and `GET /api/setup-status`) shows live, step-by-step what is
> wired up and what to do next — Step 0, surfaced inside the app.

---

## How it works

```mermaid
flowchart LR
  U[Topic / Full scan] --> R[Retrieve]
  R -->|PROVIDER=mock| M[(Synthetic corpus)]
  R -->|PROVIDER=foundry| F[Foundry IQ<br/>agentic retrieval]
  R --> E[Extract atomic claims]
  E --> C[Cluster by subject]
  C --> D[Detect contradictions<br/>LLM, claim vs claim]
  D --> G{≥2 distinct<br/>cited sources?}
  G -->|no| X[drop — grounding guardrail]
  G -->|yes| K[Rank by severity + confidence]
  K --> O[Cited contradiction report]
```

The **knowledge-retrieval boundary** ([`providers/base.py`](backend/providers/base.py)) makes
the reasoning engine identical whether passages come from the local
[`MockProvider`](backend/providers/mock_provider.py) or the real
[`FoundryIQProvider`](backend/providers/foundry_provider.py). The two reasoning steps live in
[`reasoning/pipeline.py`](backend/reasoning/pipeline.py) with prompts in
[`reasoning/prompts.py`](backend/reasoning/prompts.py).

### Foundry IQ integration (the required Microsoft IQ layer)

`FoundryIQProvider` calls a **Foundry IQ knowledge base** through Azure AI Search
**agentic retrieval**: the knowledge base decomposes the query into parallel subqueries
across its knowledge sources, semantically reranks, enforces permissions, and returns
**extractive content with references**. That multi-source, *cited* grounding is exactly what
Crosscheck needs to find a contradiction and prove it. Setup: [`infra/README.md`](infra/README.md).

### Reliability & safety

- **Grounding guardrail** — a contradiction needs two claims from two *different* sources;
  unsupported candidates are dropped.
- Every claim and conflict side carries a `SourceRef` (document · section · version · date).
- **Suggested resolutions are labelled as suggestions**, with the heuristic shown (higher
  authority, else more recent) — never asserted as truth.
- Deterministic ranking; graceful "no contradictions found"; auto-fallback to the cached
  report if a live LLM call fails — the demo never hard-crashes.
- The bundled corpus is **synthetic** — no confidential data (per the hackathon Disclaimer).

---

## Project structure

```
backend/
  app.py                 FastAPI: serves the SPA + POST /api/scan
  config.py  models.py   settings + pydantic domain models
  providers/             KnowledgeProvider boundary: mock + Foundry IQ
  reasoning/             pipeline, LLM client, prompts
corpus/                  8 synthetic sources with planted contradictions
web/                     single-page UI (index.html + app.js)
samples/cached_report.json   offline demo / test oracle
infra/                   Azure provisioning + Foundry IQ setup guide
```

## How it maps to the rubric

| Criterion | Where |
| --- | --- |
| Accuracy & relevance | Reasoning track + Foundry IQ; every output cited |
| Reasoning & multi-step | retrieve → extract → cluster → detect → rank, visible in the trace |
| Creativity & originality | inverts RAG: finds disagreements, not answers |
| UX & presentation | animated trace, severity filters, side-by-side cited cards |
| Reliability & safety | 2-source guardrail, labelled suggestions, graceful fallback |

## License

MIT — see [LICENSE](LICENSE). Demo corpus is fictional and for demonstration only.
