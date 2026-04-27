"""
scraper/retry.py — Shared HTTP fetch helper with exponential backoff.

Usage:
    from .retry import fetch_with_retry
    resp = await fetch_with_retry(client, url, label="[Greenhouse] stripe")
"""
from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

# Status codes that are transient and worth retrying
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


async def fetch_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    max_retries: int = 3,
    base_delay: float = 1.0,
    label: str = "",
) -> httpx.Response:
    """
    GET *url*, retrying up to *max_retries* times on transient failures.

    Retry triggers:
    - HTTP status in _RETRYABLE_STATUSES (429, 500, 502, 503, 504)
    - httpx.TimeoutException or httpx.ConnectError

    Backoff: base_delay * 2^(attempt-1)  →  1 s, 2 s, 4 s by default.

    Raises the last exception if every attempt fails.
    """
    last_exc: Exception | None = None

    for attempt in range(max_retries + 1):
        if attempt > 0:
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(
                "%sRetrying %s in %.1f s (attempt %d/%d)",
                label,
                url,
                delay,
                attempt,
                max_retries,
            )
            await asyncio.sleep(delay)

        try:
            resp = await client.get(url, headers=headers or {})

            if resp.status_code in _RETRYABLE_STATUSES and attempt < max_retries:
                logger.warning("%sHTTP %s for %s — will retry", label, resp.status_code, url)
                last_exc = httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}",
                    request=resp.request,
                    response=resp,
                )
                continue

            resp.raise_for_status()
            return resp

        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc = exc
            if attempt == max_retries:
                raise
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if exc.response.status_code not in _RETRYABLE_STATUSES or attempt == max_retries:
                raise

    raise last_exc  # type: ignore[misc]
