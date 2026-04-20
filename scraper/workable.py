"""
scraper/workable.py - Scraper for Workable's public XML job feed.

Official docs:
  https://help.workable.com/hc/en-us/articles/4420464031767-Utilizing-the-XML-Job-Feed
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx

from .base import BaseJobScraper
from .html_jobs import iter_workable_jobs, strip_html

logger = logging.getLogger(__name__)
_WORKABLE_XML_URL = "https://www.workable.com/boards/workable.xml"


class WorkableScraper(BaseJobScraper):
    SOURCE_NAME = "workable_xml"

    def __init__(self) -> None:
        self._jobs_cache: list[dict[str, str]] | None = None
        self._cache_lock = asyncio.Lock()

    async def fetch_jobs(self, company_slug: str) -> list[dict]:
        if self._jobs_cache is None:
            async with self._cache_lock:
                if self._jobs_cache is None:
                    async with httpx.AsyncClient(timeout=90) as client:
                        try:
                            resp = await client.get(_WORKABLE_XML_URL)
                            resp.raise_for_status()
                        except httpx.HTTPStatusError as exc:
                            logger.error("[Workable] feed -> HTTP %s", exc.response.status_code)
                            return []
                        except httpx.RequestError as exc:
                            logger.error("[Workable] feed -> request error: %s", exc)
                            return []
                    self._jobs_cache = iter_workable_jobs(resp.content)

        company_name = company_slug.strip().lower()
        matches = [
            job
            for job in self._jobs_cache
            if str(job.get("company") or "").strip().lower() == company_name
        ]
        logger.info("[Workable] %s: %d job(s) matched global feed", company_slug, len(matches))
        return [self.parse_job(job, company_slug) for job in matches]

    def parse_job(self, raw: dict, company_slug: str) -> dict:
        location_parts = [
            str(raw.get("city") or "").strip(),
            str(raw.get("state") or "").strip(),
            str(raw.get("country") or "").strip(),
        ]
        location = ", ".join(part for part in location_parts if part)
        if not location and str(raw.get("remote") or "").strip().lower() == "true":
            location = "Remote"

        return {
            "title": raw.get("title", "Untitled"),
            "company": raw.get("company") or company_slug,
            "location": location,
            "description": strip_html(raw.get("description", "") or ""),
            "url": raw.get("url", ""),
            "source": self.SOURCE_NAME,
            "raw_html": json.dumps(raw, default=str),
            "salary_min": None,
            "salary_max": None,
        }
