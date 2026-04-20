"""
scraper/greenhouse.py - Scraper for the Greenhouse public job board API.

API docs: https://developers.greenhouse.io/job-board.html
Endpoint: GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true
"""
import json
import logging
import re

import httpx

from .base import BaseJobScraper

logger = logging.getLogger(__name__)

_GREENHOUSE_URL = (
    "https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true"
)


class GreenhouseScraper(BaseJobScraper):
    SOURCE_NAME = "greenhouse"

    async def fetch_jobs(self, company_slug: str) -> list[dict]:
        """Fetch all jobs for one Greenhouse company slug."""
        url = _GREENHOUSE_URL.format(company=company_slug)
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "[Greenhouse] %s -> HTTP %s", company_slug, exc.response.status_code
                )
                return []
            except httpx.RequestError as exc:
                logger.error("[Greenhouse] %s -> request error: %s", company_slug, exc)
                return []

        data = resp.json()
        raw_jobs: list[dict] = data.get("jobs", [])
        logger.info("[Greenhouse] %s: %d job(s) fetched", company_slug, len(raw_jobs))
        return [self.parse_job(j, company_slug) for j in raw_jobs]

    def parse_job(self, raw: dict, company_slug: str) -> dict:
        """Normalize a single Greenhouse job object."""
        location = ""
        if raw.get("location") and isinstance(raw["location"], dict):
            location = raw["location"].get("name", "")

        # Strip HTML tags from content for cleaner LLM input
        description_html: str = raw.get("content", "") or ""
        description = _strip_html(description_html)

        # Greenhouse sometimes embeds compensation in metadata
        salary_min, salary_max = _parse_salary(raw)

        return {
            "title":       raw.get("title", "Untitled"),
            "company":     company_slug,
            "location":    location,
            "description": description,
            "url":         raw.get("absolute_url", ""),
            "source":      self.SOURCE_NAME,
            "raw_html":    json.dumps(raw, default=str),
            "salary_min":  salary_min,
            "salary_max":  salary_max,
        }


# Helpers

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s{2,}")


def _strip_html(html: str) -> str:
    text = _HTML_TAG_RE.sub(" ", html)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&nbsp;", " ").replace("&#39;", "'").replace("&quot;", '"')
    return _WHITESPACE_RE.sub(" ", text).strip()


def _parse_salary(raw: dict) -> tuple[int | None, int | None]:
    """
    Try to extract salary range from Greenhouse metadata fields.
    Greenhouse does not expose salary on the public API for most companies,
    so this returns (None, None) in most cases.
    """
    metadata: list[dict] = raw.get("metadata", []) or []
    for field in metadata:
        name_lower = (field.get("name") or "").lower()
        if "salary" in name_lower or "compensation" in name_lower:
            value = field.get("value")
            if isinstance(value, dict):
                return value.get("min_value"), value.get("max_value")
    return None, None
