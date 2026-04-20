"""
scraper/ashby.py - Scraper for Ashby's public job postings API.

Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
Endpoint:
  GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}
"""
from __future__ import annotations

import json
import logging

import httpx

from .base import BaseJobScraper

logger = logging.getLogger(__name__)
_ASHBY_URL = "https://api.ashbyhq.com/posting-api/job-board/{board_name}?includeCompensation=true"


class AshbyScraper(BaseJobScraper):
    SOURCE_NAME = "ashby"

    async def fetch_jobs(self, company_slug: str) -> list[dict]:
        url = _ASHBY_URL.format(board_name=company_slug)
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.error("[Ashby] %s -> HTTP %s", company_slug, exc.response.status_code)
                return []
            except httpx.RequestError as exc:
                logger.error("[Ashby] %s -> request error: %s", company_slug, exc)
                return []

        payload = resp.json()
        raw_jobs: list[dict] = payload.get("jobs", []) or []
        logger.info("[Ashby] %s: %d job(s) fetched", company_slug, len(raw_jobs))
        return [self.parse_job(job, company_slug) for job in raw_jobs if job.get("isListed", True)]

    def parse_job(self, raw: dict, company_slug: str) -> dict:
        salary_min = None
        salary_max = None
        compensation = raw.get("compensation") or {}
        tiers = compensation.get("compensationTiers") or []
        if isinstance(tiers, list):
            mins = []
            maxes = []
            for tier in tiers:
                if not isinstance(tier, dict):
                    continue
                mins.extend(_collect_numeric_values(tier, {"min", "minimum", "minValue"}))
                maxes.extend(_collect_numeric_values(tier, {"max", "maximum", "maxValue"}))
            salary_min = min(mins) if mins else None
            salary_max = max(maxes) if maxes else None

        return {
            "title": raw.get("title", "Untitled"),
            "company": company_slug,
            "location": raw.get("location", "") or _address_to_location(raw.get("address") or {}),
            "description": raw.get("descriptionPlain", "") or "",
            "url": raw.get("jobUrl") or raw.get("applyUrl") or "",
            "source": self.SOURCE_NAME,
            "raw_html": json.dumps(raw, default=str),
            "salary_min": salary_min,
            "salary_max": salary_max,
        }


def _collect_numeric_values(node: dict, keys: set[str]) -> list[int]:
    values: list[int] = []
    for key, value in node.items():
        if key not in keys:
            if isinstance(value, dict):
                values.extend(_collect_numeric_values(value, keys))
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        values.extend(_collect_numeric_values(item, keys))
            continue

        try:
            values.append(int(float(str(value))))
        except ValueError:
            continue
    return values


def _address_to_location(address: dict) -> str:
    postal = address.get("postalAddress") if isinstance(address, dict) else {}
    if not isinstance(postal, dict):
        return ""
    parts = [
        str(postal.get("addressLocality") or "").strip(),
        str(postal.get("addressRegion") or "").strip(),
        str(postal.get("addressCountry") or "").strip(),
    ]
    return ", ".join(part for part in parts if part)
