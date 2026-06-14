# Crosscheck — Upgrade Backlog

Queued enhancements to differentiate Crosscheck for the Microsoft Agents League
(Reasoning track). Ordered by impact-per-effort. **Status: queued — not yet started.**

---

## Queue

### 1. Verifier / Critic agent step  `[queued]`
Turn the one-shot pipeline into visible multi-step agentic reasoning.
- After contradictions are detected, run a second reasoning pass that *challenges* each
  candidate conflict ("are these claims really about the same subject? is this a real
  contradiction or just different scope/conditions?").
- Discard or down-rank weak conflicts; record the critique in the reasoning trace so the
  multi-step thinking is demoable.
- **Scores:** Reasoning & Multi-step Thinking (20%), Reliability & Safety (20%).
- **Touches:** `backend/reasoning/pipeline.py`, `backend/reasoning/prompts.py`, trace output.

### 2. Resolution-drafting agent  `[queued]`
A third agent that *drafts corrected policy text* to resolve each conflict.
- Goes beyond the current heuristic "suggested resolution" — produces concrete proposed
  wording that reconciles both sides (or flags that a human must decide).
- Labelled clearly as a suggestion, with the basis shown (authority / recency).
- **Scores:** Creativity & Originality (15%), UX & Presentation (15%).
- **Touches:** `backend/reasoning/pipeline.py`, `prompts.py`, models, conflict card UI.

### 3. Live document upload  `[queued]`
Let users drop in their own documents and audit them on the spot.
- Upload endpoint + UI dropzone; parse into the same passage/claim model the corpus uses.
- Far stronger demo than a fixed bundled corpus.
- **Scores:** UX & Presentation (15%), Accuracy & Relevance (20%).
- **Touches:** `backend/app.py` (upload route), providers, `web/index.html` + `app.js`.

### 4. Wire up real Foundry IQ  `[queued — needs Azure access]`
Move off the mock provider to a real Foundry IQ knowledge base.
- Targets the dedicated **Best Use of IQ Tools** prize.
- Blocked on confirming Azure AI Foundry access (see `infra/README.md`).
- **Touches:** `backend/providers/foundry_provider.py`, `infra/`, config.

---

## Notes
- Build order keeps the demo working at every step (verifier → resolution → upload → Foundry).
- Items 1–3 require no cloud access; item 4 is the only one gated on Azure.
