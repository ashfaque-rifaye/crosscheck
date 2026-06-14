"""FastAPI application for Crosscheck.

Serves the single-page UI and one JSON endpoint, /api/scan, that runs the
contradiction-audit pipeline and returns a grounded, cited Report.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.config import WEB_DIR, get_settings
from backend.models import Report
from backend.reasoning.pipeline import get_provider, run_audit

app = FastAPI(title="Crosscheck — Contradiction Auditor", version="1.0")


class ScanRequest(BaseModel):
    query: str = ""
    mode: str = "topic"  # "topic" | "full-scan"


@app.get("/api/health")
def health() -> dict:
    settings = get_settings()
    try:
        sources = [s.model_dump() for s in get_provider(settings).sources()]
    except Exception as exc:  # e.g. Foundry not configured yet
        sources = []
        return {
            "status": "degraded",
            "provider": settings.provider_label,
            "llm_mode": settings.llm_mode,
            "sources": sources,
            "detail": f"{type(exc).__name__}: {exc}",
        }
    return {
        "status": "ok",
        "provider": settings.provider_label,
        "llm_mode": settings.llm_mode,
        "sources": sources,
    }


@app.post("/api/scan", response_model=Report)
def scan(req: ScanRequest) -> Report:
    mode = "full-scan" if req.mode == "full-scan" else "topic"
    return run_audit(req.query.strip(), mode)


@app.get("/api/setup-status")
def setup_status() -> dict:
    """Drives the in-app Setup panel: what's configured and the next step.

    This is "Step 0" surfaced inside the app so you can see, live, whether the
    LLM and Foundry IQ are wired up — and exactly what to do next.
    """
    s = get_settings()
    llm_ok = s.llm_mode != "offline"
    search_cfg = bool(s.azure_search_endpoint and s.azure_search_api_key)
    foundry_active = s.provider.lower() == "foundry"
    llm_value = {
        "azure": "Azure OpenAI",
        "openai": "OpenAI-compatible",
        "offline": "Offline (cached report)",
    }[s.llm_mode]

    checks = [
        {
            "id": "llm",
            "label": "Reasoning LLM",
            "state": "ok" if llm_ok else "todo",
            "value": llm_value,
            "hint": "Live reasoning is on."
            if llm_ok
            else "Deploy a chat model (e.g. gpt-4o-mini) in Foundry, then set "
            "AZURE_OPENAI_ENDPOINT / _API_KEY / _DEPLOYMENT in .env.",
        },
        {
            "id": "search",
            "label": "Foundry IQ knowledge base",
            "state": "ok" if search_cfg else "todo",
            "value": "configured" if search_cfg else "not set",
            "hint": "Connected." if search_cfg else "Run infra/setup_foundry_iq.ps1 (it "
            "uploads the bundled corpus for you — an empty Azure is expected), create the "
            "knowledge base in the portal, then set AZURE_SEARCH_* in .env.",
        },
        {
            "id": "provider",
            "label": "Active provider",
            "state": "ok" if (foundry_active and search_cfg) else ("todo" if foundry_active else "info"),
            "value": s.provider_label,
            "hint": "Running live on Foundry IQ."
            if (foundry_active and search_cfg)
            else "Set PROVIDER=foundry once the knowledge base is ready.",
        },
    ]

    sources: list = []
    detail = None
    try:
        sources = [sr.model_dump() for sr in get_provider(s).sources()]
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"

    if foundry_active and search_cfg and llm_ok:
        overall = "live-foundry"
    elif llm_ok:
        overall = "live-mock"
    else:
        overall = "offline"

    return {
        "overall": overall,
        "provider": s.provider_label,
        "llm_mode": s.llm_mode,
        "checks": checks,
        "sources": sources,
        "source_count": len(sources),
        "detail": detail,
    }


# Serve the SPA (index.html at "/", plus app.js etc.). Mounted last so the
# /api/* routes above take precedence.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
