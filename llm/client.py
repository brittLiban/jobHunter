"""
llm/client.py — Thin async wrapper around the Ollama HTTP API.

All LLM modules go through call_ollama(); swap this file to route to a
different backend (OpenAI-compatible, Anthropic, etc.) without touching
the rest of the codebase.
"""
import logging

import httpx

import config

logger = logging.getLogger(__name__)


async def call_ollama(prompt: str, system: str = "") -> str:
    """
    Send a single prompt to Ollama and return the raw response string.

    Always requests JSON output via the 'format' field.
    Raises httpx.HTTPError on network/HTTP failures — callers handle retries.
    """
    payload: dict = {
        "model":  config.OLLAMA_MODEL,
        "prompt": prompt,
        "format": "json",
        "stream": False,
    }
    if system:
        payload["system"] = system

    logger.debug("[Ollama] → model=%s prompt_len=%d", config.OLLAMA_MODEL, len(prompt))

    async with httpx.AsyncClient(timeout=config.OLLAMA_TIMEOUT) as client:
        try:
            resp = await client.post(config.OLLAMA_URL, json=payload)
            resp.raise_for_status()
        except httpx.ConnectError:
            logger.error(
                "[Ollama] Cannot connect to %s — is Ollama running?", config.OLLAMA_URL
            )
            raise
        except httpx.HTTPStatusError as exc:
            logger.error("[Ollama] HTTP %s: %s", exc.response.status_code, exc.response.text[:200])
            raise

    data = resp.json()
    raw = data.get("response", "")
    logger.debug("[Ollama] ← %d chars", len(raw))
    return raw
