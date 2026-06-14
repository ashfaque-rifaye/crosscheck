"""Central configuration for Crosscheck.

All settings come from environment variables (optionally a local .env file).
The app is designed to run with no configuration at all: with no LLM and no
Foundry IQ settings it falls back to an offline demo over the bundled corpus.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project paths (this file lives in <root>/backend/).
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CORPUS_DIR = PROJECT_ROOT / "corpus"
SAMPLES_DIR = PROJECT_ROOT / "samples"
WEB_DIR = PROJECT_ROOT / "web"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Which knowledge-retrieval provider to use: "mock" | "foundry".
    provider: str = "mock"

    # Reasoning LLM — Azure OpenAI (primary).
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = "gpt-4o-mini"
    azure_openai_api_version: str = "2024-10-21"

    # Reasoning LLM — OpenAI-compatible fallback (used only if Azure is unset).
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"

    # Foundry IQ knowledge base (Azure AI Search agentic retrieval).
    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""
    azure_search_knowledge_base: str = "crosscheck-kb"
    azure_search_api_version: str = "2025-08-01-preview"
    # Optional full override for the retrieve URL. If empty, the provider builds
    # "{endpoint}/knowledgeBases/{kb}/retrieve?api-version=...". Copy the exact
    # retrieve URL from your Foundry IQ portal if the preview path differs.
    azure_search_retrieve_url: str = ""

    # Behavior.
    offline_demo: bool = False
    max_passages: int = 24

    @property
    def llm_mode(self) -> str:
        """Which LLM backend is active: 'azure' | 'openai' | 'offline'."""
        if self.offline_demo:
            return "offline"
        if self.azure_openai_endpoint and self.azure_openai_api_key:
            return "azure"
        if self.openai_api_key:
            return "openai"
        return "offline"

    @property
    def provider_label(self) -> str:
        """Human-readable provider name for the UI badge."""
        return "Foundry IQ" if self.provider.lower() == "foundry" else "Mock corpus"


@lru_cache
def get_settings() -> Settings:
    return Settings()
