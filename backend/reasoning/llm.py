"""LLM client for the reasoning engine.

Primary backend is Azure OpenAI (on-theme for the Microsoft hackathon); an
OpenAI-compatible endpoint is supported as a fallback. When neither is
configured the client reports unavailable and the pipeline switches to the
offline cached report.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from backend.config import Settings


def _loads(s: str) -> dict[str, Any]:
    """Parse JSON, tolerating stray prose around the object."""
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        start, end = s.find("{"), s.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(s[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {}


class LLMClient:
    def __init__(self, settings: Settings):
        self.mode = settings.llm_mode
        self._client: Any = None
        self._model: Optional[str] = None

        if self.mode == "azure":
            from openai import AzureOpenAI

            self._client = AzureOpenAI(
                azure_endpoint=settings.azure_openai_endpoint,
                api_key=settings.azure_openai_api_key,
                api_version=settings.azure_openai_api_version,
            )
            self._model = settings.azure_openai_deployment
        elif self.mode == "openai":
            from openai import OpenAI

            self._client = OpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url or None,
            )
            self._model = settings.openai_model

    def available(self) -> bool:
        return self._client is not None

    def chat_json(self, system: str, user: str, temperature: float = 0.0) -> dict[str, Any]:
        if not self._client:
            raise RuntimeError("No LLM configured")
        resp = self._client.chat.completions.create(
            model=self._model,
            temperature=temperature,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return _loads(resp.choices[0].message.content or "{}")


def get_llm_client(settings: Settings) -> Optional[LLMClient]:
    client = LLMClient(settings)
    return client if client.available() else None
