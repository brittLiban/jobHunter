"""
scraper/company_site.py - Discover jobs from company careers pages and sitemaps.

This scraper is intentionally generic:
- Crawl configured careers URLs on the company's domain
- Follow additional same-domain careers/job pages
- Collect direct ATS links exposed on the site
- Parse JobPosting JSON-LD when available
- Fall back to generic page parsing for first-party job pages
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Any
from urllib.parse import urlparse

import httpx

from .html_jobs import (
    extract_jobposting_objects,
    extract_links,
    extract_sitemap_urls,
    generic_page_to_record,
    jobposting_to_record,
    looks_like_job_link,
    normalize_job_url,
)
from .retry import fetch_with_retry

logger = logging.getLogger(__name__)
_USER_AGENT = "job-hunter/1.0 (+https://github.com/brittLiban/jobHunter)"
_PAGE_BATCH_DELAY = 0.3  # seconds between crawl page batches
_GENERIC_LINK_TEXT = {
    "",
    "jobs",
    "job",
    "careers",
    "career",
    "benefits",
    "university",
    "life at stripe",
    "see open roles",
    "see open positions",
    "open roles",
    "open positions",
}


class CompanySiteScraper:
    SOURCE_NAME = "company_site"

    def __init__(
        self,
        target: dict[str, Any],
        *,
        max_pages: int,
        max_job_urls: int,
        sitemap_enabled: bool = True,
    ) -> None:
        self.target = target
        self.company_name = str(target.get("name") or target.get("domain") or "company").strip()
        self.domain = str(target.get("domain") or "").strip().lower()
        self.careers_urls = [
            normalize_job_url(str(url))
            for url in (target.get("careers_urls") or [])
            if str(url).strip()
        ]
        self.max_pages = max(1, max_pages)
        self.max_job_urls = max(1, max_job_urls)
        self.sitemap_enabled = sitemap_enabled

    async def fetch_jobs(self) -> list[dict]:
        if not self.domain or not self.careers_urls:
            return []

        discovered: dict[str, dict] = {}
        pending_pages: deque[str] = deque(self.careers_urls)
        queued_pages = set(self.careers_urls)
        visited_pages: set[str] = set()
        job_links: dict[str, str] = {}

        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        ) as client:
            if self.sitemap_enabled:
                sitemap_pages, sitemap_job_links = await self._discover_from_sitemaps(client)
                for url in sitemap_pages:
                    if (
                        url not in queued_pages
                        and len(queued_pages) < self.max_pages
                    ):
                        pending_pages.append(url)
                        queued_pages.add(url)
                for url, title_hint in sitemap_job_links.items():
                    if len(job_links) >= self.max_job_urls:
                        break
                    job_links.setdefault(url, title_hint)

            first_batch = True
            while pending_pages and len(visited_pages) < self.max_pages:
                batch: list[str] = []
                while pending_pages and len(batch) < 4 and len(visited_pages) + len(batch) < self.max_pages:
                    url = pending_pages.popleft()
                    if url in visited_pages:
                        continue
                    batch.append(url)

                if not first_batch:
                    await asyncio.sleep(_PAGE_BATCH_DELAY)
                first_batch = False

                html_results = await asyncio.gather(
                    *(self._fetch_text(client, url) for url in batch),
                    return_exceptions=True,
                )
                for url, html in zip(batch, html_results):
                    visited_pages.add(url)
                    if isinstance(html, Exception) or not html:
                        continue

                    for record in self._records_from_json_ld(html, url):
                        discovered.setdefault(record["url"], record)

                    for link in extract_links(html, url):
                        link_url = normalize_job_url(link["url"])
                        link_text = str(link.get("text") or "").strip()
                        if not link_url:
                            continue

                        if self._should_follow_page(link_url) and link_url not in queued_pages:
                            if len(queued_pages) < self.max_pages:
                                pending_pages.append(link_url)
                                queued_pages.add(link_url)

                        if self._should_collect_job_url(link_url, link_text):
                            if len(job_links) < self.max_job_urls:
                                existing_hint = job_links.get(link_url, "")
                                job_links[link_url] = existing_hint or link_text

            unfetched_job_urls = [
                url
                for url in job_links
                if url not in discovered
            ][: self.max_job_urls]

            job_results = await asyncio.gather(
                *(self._fetch_job_record(client, url, job_links.get(url, "")) for url in unfetched_job_urls),
                return_exceptions=True,
            )
            for result in job_results:
                if isinstance(result, Exception) or result is None:
                    continue
                discovered.setdefault(result["url"], result)

        jobs = list(discovered.values())
        logger.info("[CompanySite] %s: %d job(s) discovered", self.company_name, len(jobs))
        return jobs

    async def _fetch_job_record(
        self,
        client: httpx.AsyncClient,
        url: str,
        title_hint: str,
    ) -> dict | None:
        html = await self._fetch_text(client, url)
        if not html:
            return None

        json_ld_records = self._records_from_json_ld(html, url)
        if json_ld_records:
            return json_ld_records[0]

        return generic_page_to_record(
            html,
            url,
            self.company_name,
            self.SOURCE_NAME,
            title_hint=title_hint,
        )

    def _records_from_json_ld(self, html: str, page_url: str) -> list[dict]:
        records: list[dict] = []
        for payload in extract_jobposting_objects(html):
            record = jobposting_to_record(
                payload,
                page_url,
                self.company_name,
                self.SOURCE_NAME,
            )
            if record is not None:
                record["url"] = normalize_job_url(record["url"])
                records.append(record)
        return records

    async def _discover_from_sitemaps(
        self,
        client: httpx.AsyncClient,
    ) -> tuple[list[str], dict[str, str]]:
        sitemap_candidates = {
            normalize_job_url(f"https://{self.domain}/sitemap.xml"),
        }
        robots_url = normalize_job_url(f"https://{self.domain}/robots.txt")
        robots_text = await self._fetch_text(client, robots_url)
        if robots_text:
            for line in robots_text.splitlines():
                if line.lower().startswith("sitemap:"):
                    _, _, value = line.partition(":")
                    if value.strip():
                        sitemap_candidates.add(normalize_job_url(value.strip()))

        queued = deque(sorted(sitemap_candidates))
        seen_sitemaps: set[str] = set()
        pages: list[str] = []
        job_links: dict[str, str] = {}

        while queued and len(seen_sitemaps) < 8:
            sitemap_url = queued.popleft()
            if sitemap_url in seen_sitemaps:
                continue
            seen_sitemaps.add(sitemap_url)

            try:
                response = await client.get(sitemap_url)
                response.raise_for_status()
            except httpx.HTTPError:
                continue

            for loc in extract_sitemap_urls(response.content):
                normalized = normalize_job_url(loc)
                if not normalized:
                    continue
                if self._looks_like_sitemap_url(normalized):
                    if normalized not in seen_sitemaps:
                        queued.append(normalized)
                    continue
                if self._should_collect_job_url(normalized, ""):
                    if len(job_links) < self.max_job_urls:
                        job_links.setdefault(normalized, "")
                    continue
                if self._should_follow_page(normalized) and len(pages) < self.max_pages:
                    pages.append(normalized)

        return pages, job_links

    async def _fetch_text(self, client: httpx.AsyncClient, url: str) -> str:
        try:
            response = await fetch_with_retry(
                client, url, label=f"[CompanySite] {self.company_name} "
            )
        except httpx.HTTPStatusError as exc:
            logger.debug(
                "[CompanySite] %s -> HTTP %s for %s",
                self.company_name,
                exc.response.status_code,
                url,
            )
            return ""
        except httpx.RequestError as exc:
            logger.debug("[CompanySite] %s -> request error for %s: %s", self.company_name, url, exc)
            return ""

        content_type = response.headers.get("content-type", "").lower()
        if "text/html" not in content_type and "text/plain" not in content_type:
            return ""
        return response.text

    def _should_follow_page(self, url: str) -> bool:
        parsed = urlparse(url)
        if not parsed.scheme.startswith("http"):
            return False
        if not self._is_same_company_host(parsed.netloc):
            return False
        path = parsed.path.lower()
        if not path or path in {"/"}:
            return False
        if any(path.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf")):
            return False
        if "career" in path or "job" in path or "opening" in path or "position" in path or "intern" in path:
            return True
        return False

    def _should_collect_job_url(self, url: str, link_text: str) -> bool:
        parsed = urlparse(url)
        if not parsed.scheme.startswith("http"):
            return False
        normalized_text = link_text.strip().lower()

        if looks_like_job_link(url, link_text, self.domain):
            if not self._is_same_company_host(parsed.netloc):
                return True
            if normalized_text in _GENERIC_LINK_TEXT:
                return False
            path = parsed.path.lower()
            if "/jobs/search" in path or path.endswith("/jobs") or path.endswith("/careers"):
                return False
            last_segment = path.rstrip("/").split("/")[-1]
            has_detail_marker = any(
                marker in path
                for marker in ("listing", "opening", "position", "/job/")
            )
            has_numeric_tail = any(char.isdigit() for char in last_segment)
            has_role_like_hint = (
                len(normalized_text.split()) >= 3
                and any(
                    token in last_segment
                    for token in (
                        "engineer",
                        "developer",
                        "intern",
                        "analyst",
                        "specialist",
                        "consultant",
                        "designer",
                        "associate",
                    )
                )
            )
            if not (has_detail_marker or has_numeric_tail or has_role_like_hint):
                return False
            return True

        return False

    def _looks_like_sitemap_url(self, url: str) -> bool:
        parsed = urlparse(url)
        path = parsed.path.lower()
        return path.endswith(".xml") or "sitemap" in path

    def _is_same_company_host(self, host: str) -> bool:
        normalized_host = host.lower().split(":")[0]
        return normalized_host == self.domain or normalized_host.endswith(f".{self.domain}")
