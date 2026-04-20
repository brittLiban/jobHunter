"""
scraper/lever.py - Scraper for Lever's public Postings API.

Primary references:
- https://help.lever.co/hc/en-us/articles/20087307202333-Configuring-your-Lever-hosted-Job-Site
- https://github.com/lever/postings-api
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx

from .base import BaseJobScraper
from .html_jobs import strip_html

logger = logging.getLogger(__name__)
_LEVER_LIST_URL = "https://api.lever.co/v0/postings/{site_name}?mode=json&skip={skip}&limit={limit}"
_LEVER_DETAIL_URL = "https://api.lever.co/v0/postings/{site_name}/{posting_id}?mode=json"
_PAGE_SIZE = 100


class LeverScraper(BaseJobScraper):
    SOURCE_NAME = "lever"

    async def fetch_jobs(self, company_slug: str) -> list[dict]:
        records: list[dict] = []
        skip = 0
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                url = _LEVER_LIST_URL.format(site_name=company_slug, skip=skip, limit=_PAGE_SIZE)
                try:
                    resp = await client.get(url, headers={"Accept": "application/json"})
                    resp.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    logger.error("[Lever] %s -> HTTP %s", company_slug, exc.response.status_code)
                    break
                except httpx.RequestError as exc:
                    logger.error("[Lever] %s -> request error: %s", company_slug, exc)
                    break

                payload = resp.json()
                if not isinstance(payload, list) or not payload:
                    break

                records.extend(payload)
                if len(payload) < _PAGE_SIZE:
                    break
                skip += _PAGE_SIZE

            if not records:
                return []

            detailed = await _hydrate_postings(client, company_slug, records)

        logger.info("[Lever] %s: %d job(s) fetched", company_slug, len(detailed))
        return [self.parse_job(job, company_slug) for job in detailed]

    def parse_job(self, raw: dict, company_slug: str) -> dict:
        categories = raw.get("categories") or {}
        all_locations = categories.get("allLocations") if isinstance(categories, dict) else None
        location = ""
        if isinstance(categories, dict):
            location = str(categories.get("location") or "").strip()
        if not location and isinstance(all_locations, list):
            location = ", ".join(str(item).strip() for item in all_locations if str(item).strip())

        description = raw.get("descriptionPlain") or raw.get("description") or ""
        if "<" in description:
            description = strip_html(description)

        url = (
            raw.get("hostedUrl")
            or raw.get("applyUrl")
            or f"https://jobs.lever.co/{company_slug}/{raw.get('id', '')}"
        )

        return {
            "title": raw.get("text", "Untitled"),
            "company": company_slug,
            "location": location,
            "description": description,
            "url": url,
            "source": self.SOURCE_NAME,
            "raw_html": json.dumps(raw, default=str),
            "salary_min": None,
            "salary_max": None,
        }


async def _hydrate_postings(
    client: httpx.AsyncClient,
    site_name: str,
    postings: list[dict],
) -> list[dict]:
    async def fetch_detail(posting: dict) -> dict:
        if posting.get("descriptionPlain") or posting.get("description"):
            return posting

        posting_id = posting.get("id")
        if not posting_id:
            return posting

        url = _LEVER_DETAIL_URL.format(site_name=site_name, posting_id=posting_id)
        try:
            resp = await client.get(url, headers={"Accept": "application/json"})
            resp.raise_for_status()
        except httpx.HTTPError:
            return posting

        detail = resp.json()
        return detail if isinstance(detail, dict) else posting

    return await _gather_in_batches([fetch_detail(posting) for posting in postings], batch_size=10)


async def _gather_in_batches(tasks: list, batch_size: int) -> list:
    results: list = []
    for index in range(0, len(tasks), batch_size):
        chunk = tasks[index : index + batch_size]
        results.extend(await asyncio.gather(*chunk))
    return results
