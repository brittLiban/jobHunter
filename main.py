"""
main.py — Job Hunter pipeline entry point.

Pipeline order:
  1. Scrape all companies listed in config.COMPANY_SLUGS
  2. Deduplicate and insert new jobs into the database
  3. For each unscored job: extract metadata → filter → score
  4. For priority jobs (score >= 80): run tailoring calls
  5. Print a summary table to stdout

Concurrency: asyncio with a semaphore of MAX_CONCURRENT_LLM (default 2)
so we don't overload the local Ollama instance.
"""
import asyncio
import logging
import sys
from typing import Literal

import config
from database.db import (
    create_application,
    get_unscored_jobs,
    get_user_profile,
    init_db,
    insert_job,
    seed_user_profile,
)
from llm.extractor import extract_job_data
from llm.scorer import score_job
from llm.tailor import generate_answers, tailor_resume
from scraper.greenhouse import GreenhouseScraper
from tracker.tracker import log_extraction, log_filtered, log_score, log_tailor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

ResultKind = Literal["scored", "priority", "filtered", "failed"]


# ── Scraping ──────────────────────────────────────────────────────────────────

async def scrape_all() -> list[dict]:
    """Fetch jobs from all configured companies concurrently."""
    scraper = GreenhouseScraper()
    tasks = [scraper.fetch_jobs(slug) for slug in config.COMPANY_SLUGS]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_jobs: list[dict] = []
    for slug, result in zip(config.COMPANY_SLUGS, results):
        if isinstance(result, Exception):
            logger.error("[Scraper] %s failed: %s", slug, result)
        else:
            all_jobs.extend(result)

    return all_jobs


# ── Filtering ─────────────────────────────────────────────────────────────────

def _filter_reason(extracted, location: str, prefs: dict) -> str | None:
    """Return a rejection reason string, or None if the job passes."""
    if extracted.requires_sponsorship:
        return "requires_sponsorship"
    if extracted.is_contract:
        return "is_contract"
    if not extracted.is_remote:
        preferred = [loc.lower() for loc in prefs.get("preferred_locations", [])]
        loc_lower = location.lower()
        if not any(p in loc_lower for p in preferred):
            return f"location_mismatch ({location or 'unknown'})"
    return None


# ── Per-job processing ────────────────────────────────────────────────────────

async def process_job(
    job: dict,
    profile: dict,
    semaphore: asyncio.Semaphore,
) -> ResultKind:
    """
    Run the full pipeline for a single unscored job.
    The semaphore limits concurrent Ollama calls.
    """
    job_id: int = job["id"]
    title:  str = job["title"]
    company: str = job["company"]
    description: str = job.get("description") or ""
    location: str = job.get("location") or ""

    app_id = create_application(job_id, status="found")
    resume = profile["resume_text"]
    prefs  = profile.get("preferences_json", {})

    async with semaphore:
        logger.info("[Pipeline] Processing: %s @ %s (app=%d)", title, company, app_id)

        # ── Step 1: Extract ───────────────────────────────────────────────────
        extracted = await extract_job_data(description)
        if extracted is None:
            log_filtered(app_id, "extraction_failed")
            return "failed"

        log_extraction(app_id, extracted.model_dump())

        # ── Step 2: Filter ────────────────────────────────────────────────────
        reason = _filter_reason(extracted, location, prefs)
        if reason:
            log_filtered(app_id, reason)
            return "filtered"

        # ── Step 3: Score ─────────────────────────────────────────────────────
        scored = await score_job(resume, title, company, description)
        if scored is None:
            log_filtered(app_id, "scoring_failed")
            return "failed"

        is_priority = scored.score >= config.PRIORITY_SCORE
        log_score(app_id, scored.score, scored.apply, scored.model_dump(), is_priority)

        if scored.score < config.MIN_SCORE:
            log_filtered(app_id, f"low_score ({scored.score})")
            return "filtered"

        # ── Step 4: Tailor (priority only) ────────────────────────────────────
        if is_priority:
            resume_result, answers_result = await asyncio.gather(
                tailor_resume(resume, description),
                generate_answers(resume, title, company, description),
            )

            tailored_summary = ""
            cover_letter     = ""
            tailor_data: dict = {}

            if resume_result:
                tailored_summary = resume_result.suggested_summary
                tailor_data["resume"] = resume_result.model_dump()

            if answers_result:
                cover_letter = answers_result.cover_letter_short
                tailor_data["answers"] = answers_result.model_dump()

            log_tailor(app_id, tailored_summary, cover_letter, tailor_data)
            return "priority"

        return "scored"


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> None:
    logger.info("=" * 60)
    logger.info("  JOB HUNTER — starting pipeline")
    logger.info("=" * 60)

    # 1. Bootstrap
    init_db()
    seed_user_profile(config.USER_PROFILE)
    profile = get_user_profile()
    if profile is None:
        logger.error("No user profile found — exiting.")
        return

    # 2. Scrape
    logger.info("[Scraper] Fetching jobs from %d company slug(s)…", len(config.COMPANY_SLUGS))
    all_jobs = await scrape_all()
    logger.info("[Scraper] Total jobs fetched: %d", len(all_jobs))

    # 3. Insert (deduplicate by URL)
    new_count = 0
    for job in all_jobs:
        job_id = insert_job(job)
        if job_id is not None:
            new_count += 1

    logger.info("[DB] New jobs inserted: %d  (duplicates skipped: %d)", new_count, len(all_jobs) - new_count)

    # 4. Process unscored jobs
    unscored = get_unscored_jobs()
    if not unscored:
        logger.info("[Pipeline] No unscored jobs — nothing to do.")
        _print_summary(new_count, {})
        return

    logger.info("[Pipeline] Processing %d unscored job(s)…", len(unscored))
    semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_LLM)
    tasks = [process_job(dict(j), profile, semaphore) for j in unscored]
    results: list[ResultKind] = await asyncio.gather(*tasks)  # type: ignore[assignment]

    counts = {
        "scored":   results.count("scored"),
        "priority": results.count("priority"),
        "filtered": results.count("filtered"),
        "failed":   results.count("failed"),
    }
    _print_summary(new_count, counts)


def _print_summary(new_count: int, counts: dict) -> None:
    logger.info("")
    logger.info("=" * 60)
    logger.info("  PIPELINE SUMMARY")
    logger.info("=" * 60)
    logger.info("  New jobs found     : %d", new_count)
    logger.info("  Scored (60-79)     : %d", counts.get("scored", 0))
    logger.info("  Priority (80+)     : %d", counts.get("priority", 0))
    logger.info("  Filtered out       : %d", counts.get("filtered", 0))
    logger.info("  Failed / errored   : %d", counts.get("failed", 0))
    logger.info("=" * 60)
    logger.info("  Run the dashboard: streamlit run dashboard/app.py")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
