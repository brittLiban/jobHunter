"""
scraper/discovery.py - Central job discovery registry.

Source priority is intentional. Direct ATS APIs produce cleaner structured data
than generic company-site crawling, so they win on URL collisions.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable

import config

from .ashby import AshbyScraper
from .company_site import CompanySiteScraper
from .greenhouse import GreenhouseScraper
from .html_jobs import normalize_job_url
from .lever import LeverScraper
from .workable import WorkableScraper

logger = logging.getLogger(__name__)


async def scrape_all_jobs() -> list[dict]:
    source_groups = await asyncio.gather(
        _collect_greenhouse(),
        _collect_ashby(),
        _collect_lever(),
        _collect_workable(),
        _collect_company_sites(),
        return_exceptions=True,
    )

    merged: dict[str, dict] = {}
    direct_source_titles: set[tuple[str, str]] = set()
    for group in source_groups:
        if isinstance(group, Exception):
            logger.error("[Scraper] discovery group failed: %s", group)
            continue
        for job in group:
            normalized = _normalize_job(job)
            if normalized is None:
                continue
            dedupe_key = (
                normalized["company"].strip().lower(),
                normalized["title"].strip().lower(),
            )
            if normalized["source"] == "company_site" and dedupe_key in direct_source_titles:
                continue
            merged.setdefault(normalized["url"], normalized)
            if normalized["source"] != "company_site":
                direct_source_titles.add(dedupe_key)

    jobs = list(merged.values())
    logger.info("[Scraper] Combined unique jobs: %d", len(jobs))
    return jobs


async def _collect_greenhouse() -> list[dict]:
    names = list(config.GREENHOUSE_BOARD_NAMES)
    if not names:
        return []
    return await _collect_named_source(GreenhouseScraper(), names, "Greenhouse")


async def _collect_ashby() -> list[dict]:
    names = list(config.ASHBY_BOARD_NAMES)
    if not names:
        return []
    return await _collect_named_source(AshbyScraper(), names, "Ashby")


async def _collect_lever() -> list[dict]:
    names = list(config.LEVER_SITE_NAMES)
    if not names:
        return []
    return await _collect_named_source(LeverScraper(), names, "Lever")


async def _collect_workable() -> list[dict]:
    names = list(config.WORKABLE_COMPANY_NAMES)
    if not names:
        return []
    return await _collect_named_source(WorkableScraper(), names, "Workable")


async def _collect_company_sites() -> list[dict]:
    targets = list(config.COMPANY_SITE_TARGETS)
    if not config.COMPANY_SITE_DISCOVERY_ENABLED or not targets:
        return []

    tasks: list[Awaitable[list[dict]]] = [
        CompanySiteScraper(
            target,
            max_pages=config.DISCOVERY_MAX_PAGES_PER_COMPANY,
            max_job_urls=config.DISCOVERY_MAX_JOB_URLS_PER_COMPANY,
            sitemap_enabled=config.SITEMAP_DISCOVERY_ENABLED,
        ).fetch_jobs()
        for target in targets
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    jobs: list[dict] = []
    for target, result in zip(targets, results):
        name = str(target.get("name") or target.get("domain") or "company")
        if isinstance(result, Exception):
            logger.error("[CompanySite] %s failed: %s", name, result)
            continue
        logger.info("[CompanySite] %s: %d discovered job(s)", name, len(result))
        jobs.extend(result)
    return jobs


async def _collect_named_source(scraper, names: list[str], label: str) -> list[dict]:
    results = await asyncio.gather(
        *(scraper.fetch_jobs(name) for name in names),
        return_exceptions=True,
    )

    jobs: list[dict] = []
    for name, result in zip(names, results):
        if isinstance(result, Exception):
            logger.error("[%s] %s failed: %s", label, name, result)
            continue
        logger.info("[%s] %s: %d job(s)", label, name, len(result))
        jobs.extend(result)
    return jobs


def _normalize_job(job: dict) -> dict | None:
    url = normalize_job_url(str(job.get("url") or "").strip())
    title = str(job.get("title") or "").strip()
    company = str(job.get("company") or "").strip()
    if not url or not title or not company:
        return None

    normalized = dict(job)
    normalized["url"] = url
    normalized["title"] = title
    normalized["company"] = company
    normalized["location"] = str(job.get("location") or "").strip()
    normalized["description"] = str(job.get("description") or "").strip()
    normalized["source"] = str(job.get("source") or "unknown").strip()
    return normalized
