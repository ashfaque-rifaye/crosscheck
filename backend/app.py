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


# Serve the SPA (index.html at "/", plus app.js etc.). Mounted last so the
# /api/* routes above take precedence.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
