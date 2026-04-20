"""
scraper/base.py — Abstract base class for all job board scrapers.

To add a new source (e.g., Lever, Workable, LinkedIn):
1. Subclass BaseJobScraper
2. Implement fetch_jobs() and parse_job()
3. Register the scraper in main.py
"""
from abc import ABC, abstractmethod


class BaseJobScraper(ABC):
    """Plug-and-swap interface for any job board."""

    SOURCE_NAME: str = "unknown"

    @abstractmethod
    async def fetch_jobs(self, company_slug: str) -> list[dict]:
        """
        Fetch all open jobs for the given company slug.
        Returns a list of normalized job dicts ready for insert_job().
        """

    @abstractmethod
    def parse_job(self, raw: dict, company_slug: str) -> dict:
        """
        Transform a raw API response object into the normalized dict shape:
          title, company, location, description, url, source,
          raw_html, salary_min, salary_max
        """
