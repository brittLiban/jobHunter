"""
main.py - Job Hunter pipeline entry point.

Pipeline order:
1. Scrape all companies listed in config.COMPANY_SLUGS
2. Deduplicate and insert new jobs into the database
3. For each unscored job: extract metadata -> apply filters -> score
4. For jobs scoring 80+: run tailoring calls
5. Print a summary table to stdout
"""
import asyncio
import json
import logging
import sys
from typing import Literal

import config
from database.db import (
    create_application,
    get_auto_apply_jobs,
    get_unscored_jobs,
    get_user_profile,
    init_db,
    insert_job,
    seed_user_profile,
)
from llm.client import configure_ollama
from llm.extractor import ExtractedJob, extract_job_data
from llm.scorer import score_job
from llm.tailor import generate_answers, tailor_resume
from scraper.greenhouse import GreenhouseScraper
from submitter.service import auto_apply_job
from tracker.tracker import (
    log_apply_dry_run,
    log_apply_failure,
    log_apply_success,
    log_extraction,
    log_failure,
    log_filtered,
    log_score,
    log_tailor,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

ResultKind = Literal["scored", "priority", "filtered", "failed"]


async def scrape_all() -> list[dict]:
    """Fetch jobs from all configured companies concurrently."""
    scraper = GreenhouseScraper()
    tasks = [scraper.fetch_jobs(slug) for slug in config.COMPANY_SLUGS]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_jobs: list[dict] = []
    for slug, result in zip(config.COMPANY_SLUGS, results):
        if isinstance(result, Exception):
            logger.error("[Scraper] %s failed: %s", slug, result)
            continue
        all_jobs.extend(result)

    return all_jobs


def _has_excluded_title_keyword(title: str, excluded_keywords: list[str]) -> bool:
    title_lower = title.lower()
    return any(keyword.lower() in title_lower for keyword in excluded_keywords if keyword.strip())


def _filter_jobs_by_target_roles(
    jobs: list[dict],
    target_roles: list[str],
    excluded_keywords: list[str],
) -> tuple[list[dict], dict[str, int]]:
    """Keep only jobs whose titles match the active target role list."""
    matched: list[dict] = []
    counts = {"role_filtered": 0, "excluded_title": 0}

    for job in jobs:
        title = job.get("title", "")
        title_lower = title.lower()

        if excluded_keywords and _has_excluded_title_keyword(title, excluded_keywords):
            counts["excluded_title"] += 1
            continue

        if target_roles and not any(role.lower() in title_lower for role in target_roles if role.strip()):
            counts["role_filtered"] += 1
            continue

        matched.append(job)

    return matched, counts


def _looks_like_unknown_location(location: str) -> bool:
    return location.strip().lower() in {"", "n/a", "na", "location", "unknown"}


def _is_allowed_remote_location(location: str, prefs: dict) -> bool:
    if _looks_like_unknown_location(location):
        return True

    location_lower = location.lower()
    preferred_lower = [item.lower() for item in prefs.get("preferred_locations", []) if item.strip()]
    if any(item in location_lower for item in preferred_lower if item != "remote"):
        return True

    remote_markers = ("remote", "us-remote", "remote in us", "remote in usa")
    if not any(marker in location_lower for marker in remote_markers):
        return False

    blocked_keywords = [
        item.lower()
        for item in prefs.get("disallowed_remote_location_keywords", [])
        if str(item).strip()
    ]
    return not any(keyword in location_lower for keyword in blocked_keywords)


def _looks_potentially_location_compatible(location: str, prefs: dict) -> bool:
    """
    Keep jobs whose location text could plausibly satisfy the user's preferences.

    This is only a coarse prefilter to reduce obvious misses before LLM work.
    Final location gating still happens after extraction.
    """
    if _looks_like_unknown_location(location):
        return True

    location_lower = location.lower()
    preferred_lower = [item.lower() for item in prefs.get("preferred_locations", []) if item.strip()]
    if any(item in location_lower for item in preferred_lower if item != "remote"):
        return True

    return _is_allowed_remote_location(location, prefs)


def _prefilter_jobs_by_location(
    jobs: list[dict],
    prefs: dict,
) -> tuple[list[dict], int]:
    preferred_locations = list(prefs.get("preferred_locations") or [])
    if not config.ENABLE_LOCATION_PREFILTER or not preferred_locations:
        return jobs, 0

    kept = [
        job
        for job in jobs
        if _looks_potentially_location_compatible(job.get("location") or "", prefs)
    ]
    return kept, len(jobs) - len(kept)


def _filter_reason(extracted, location: str, prefs: dict) -> str | None:
    """Return a rejection reason string, or None if the job passes."""
    if extracted.requires_sponsorship:
        return "requires_sponsorship"
    if extracted.is_contract:
        return "is_contract"
    if prefs.get("experience_level") == "entry" and extracted.seniority != "entry":
        return f"seniority_mismatch ({extracted.seniority})"
    if extracted.is_remote and not _is_allowed_remote_location(location, prefs):
        return f"remote_location_mismatch ({location or 'unknown'})"
    if not extracted.is_remote:
        preferred = [loc.lower() for loc in prefs.get("preferred_locations", [])]
        location_lower = location.lower()
        if not any(pref in location_lower for pref in preferred if pref != "remote"):
            return f"location_mismatch ({location or 'unknown'})"
    return None


async def process_job(job: dict, profile: dict) -> ResultKind:
    """Run the full pipeline for a single unscored job."""
    job_id = job["id"]
    title = job["title"]
    company = job["company"]
    description = job.get("description") or ""
    location = job.get("location") or ""

    app_id = create_application(job_id, status="found")
    resume_text = profile["resume_text"]
    prefs = profile.get("preferences_json", {})

    logger.info("[Pipeline] Processing: %s @ %s (app=%d)", title, company, app_id)

    extracted, extracted_payload = _load_saved_extraction(job)
    if extracted is not None and extracted_payload is not None:
        logger.info("[Pipeline] Reusing saved extraction for app=%d", app_id)
    else:
        extracted, extracted_payload = await extract_job_data(resume_text, description)

    if extracted is None:
        log_failure(app_id, "extraction_failed", extracted_data=extracted_payload)
        return "failed"

    log_extraction(app_id, extracted_payload)

    reason = _filter_reason(extracted, location, prefs)
    if reason:
        log_filtered(app_id, reason, extracted_data=extracted_payload)
        return "filtered"

    scored, scorer_payload = await score_job(resume_text, title, company, description)
    if scored is None:
        log_failure(
            app_id,
            "scoring_failed",
            extracted_data=extracted_payload,
            scorer_data=scorer_payload,
        )
        return "failed"

    is_priority = scored.score >= config.PRIORITY_SCORE
    log_score(app_id, scored.score, scored.apply, scorer_payload, is_priority)

    if scored.score < config.MIN_SCORE:
        log_filtered(
            app_id,
            f"low_score ({scored.score})",
            extracted_data=extracted_payload,
            scorer_data=scorer_payload,
        )
        return "filtered"

    if is_priority:
        (resume_result, resume_payload), (answers_result, answers_payload) = await asyncio.gather(
            tailor_resume(resume_text, description),
            generate_answers(resume_text, title, company, description),
        )

        tailored_summary = ""
        cover_letter = ""
        tailor_payload = {
            "resume": resume_payload,
            "answers": answers_payload,
        }

        if resume_result is not None:
            tailored_summary = resume_result.suggested_summary

        if answers_result is not None:
            cover_letter = answers_result.cover_letter_short

        log_tailor(app_id, tailored_summary, cover_letter, tailor_payload)
        return "priority"

    return "scored"


async def run_auto_apply_queue(profile: dict) -> dict[str, int]:
    """Apply to a small queue of high-confidence scored jobs."""
    if not config.AUTO_APPLY_ENABLED:
        logger.info("[Apply] Auto-apply disabled.")
        return {"applied": 0, "dry_run": 0, "failed": 0}

    ready = get_auto_apply_jobs(limit=config.AUTO_APPLY_MAX_PER_RUN)
    if not ready:
        logger.info("[Apply] No scored jobs are ready for auto-apply.")
        return {"applied": 0, "dry_run": 0, "failed": 0}

    logger.info("[Apply] Processing %d auto-apply candidate(s)...", len(ready))
    counts = {"applied": 0, "dry_run": 0, "failed": 0}
    for row in ready:
        job = dict(row)
        app_id = job["app_id"]
        logger.info(
            "[Apply] app=%d %s @ %s",
            app_id,
            job.get("title", "Untitled"),
            job.get("company", ""),
        )
        result = await auto_apply_job(job, profile, dry_run=config.AUTO_APPLY_DRY_RUN)
        payload = result.model_dump()
        if result.success and result.submitted:
            note = "Auto-submitted via Greenhouse."
            if result.confirmation_text:
                note = f"{note} Confirmation: {result.confirmation_text}"
            log_apply_success(app_id, payload, notes=note)
            counts["applied"] += 1
            continue

        if result.success and result.dry_run:
            log_apply_dry_run(app_id, payload)
            counts["dry_run"] += 1
            continue

        reason = result.error or "unknown_auto_apply_error"
        log_apply_failure(app_id, reason, payload)
        counts["failed"] += 1

    return counts


def _load_saved_extraction(job: dict) -> tuple[ExtractedJob | None, dict | None]:
    raw = job.get("application_extracted_data")
    if not raw:
        return None, None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None, None

    result = payload.get("result")
    if not isinstance(result, dict):
        return None, None

    try:
        extracted = ExtractedJob.model_validate(result, strict=True)
    except Exception:
        return None, None

    return extracted, payload


async def main() -> None:
    logger.info("=" * 60)
    logger.info("  JOB HUNTER - starting pipeline")
    logger.info("=" * 60)

    init_db()
    configure_ollama(config.MAX_CONCURRENT_LLM)
    profile_seed_action = seed_user_profile(config.USER_PROFILE)
    logger.info("[Profile] Bootstrap profile action: %s", profile_seed_action)

    profile = get_user_profile()
    if profile is None:
        logger.error("No user profile found - exiting.")
        return

    prefs = profile.get("preferences_json", {})
    target_roles = list(prefs.get("target_roles") or config.TARGET_ROLES)
    excluded_title_keywords = list(
        prefs.get("excluded_title_keywords") or config.EXCLUDED_TITLE_KEYWORDS
    )
    logger.info("[Profile] Active resume variant: %s", prefs.get("resume_variant_key", "unknown"))
    logger.info("[Profile] Target roles: %s", ", ".join(target_roles) if target_roles else "all")
    logger.info(
        "[Profile] Excluded title keywords: %s",
        ", ".join(excluded_title_keywords) if excluded_title_keywords else "none",
    )

    logger.info("[Scraper] Fetching jobs from %d company slug(s)...", len(config.COMPANY_SLUGS))
    all_jobs = await scrape_all()
    logger.info("[Scraper] Total jobs fetched: %d", len(all_jobs))

    relevant_jobs, title_filter_counts = _filter_jobs_by_target_roles(
        all_jobs,
        target_roles,
        excluded_title_keywords,
    )
    logger.info(
        "[Scraper] Relevant jobs after title filter: %d  (role-filtered out: %d, excluded senior titles: %d)",
        len(relevant_jobs),
        title_filter_counts["role_filtered"],
        title_filter_counts["excluded_title"],
    )

    location_filtered_jobs, location_prefiltered_count = _prefilter_jobs_by_location(
        relevant_jobs,
        prefs,
    )
    logger.info(
        "[Scraper] Relevant jobs after location prefilter: %d  (location-prefiltered out: %d)",
        len(location_filtered_jobs),
        location_prefiltered_count,
    )

    new_count = 0
    for job in location_filtered_jobs:
        job_id = insert_job(job)
        if job_id is not None:
            new_count += 1

    logger.info(
        "[DB] New jobs inserted: %d  (duplicates skipped: %d)",
        new_count,
        len(location_filtered_jobs) - new_count,
    )

    unscored = get_unscored_jobs()
    total_unscored = len(unscored)
    results: list[ResultKind] = []
    if not unscored:
        logger.info("[Pipeline] No unscored jobs found in this cycle.")
    else:
        if (
            config.MAX_UNSCORED_JOBS_PER_RUN is not None
            and total_unscored > config.MAX_UNSCORED_JOBS_PER_RUN
        ):
            unscored = unscored[: config.MAX_UNSCORED_JOBS_PER_RUN]
            logger.info(
                "[Pipeline] Limiting this run to %d of %d unscored job(s). "
                "Re-run main.py to continue the queue.",
                len(unscored),
                total_unscored,
            )

        logger.info("[Pipeline] Processing %d unscored job(s)...", len(unscored))
        tasks = [process_job(dict(job), profile) for job in unscored]
        results = await asyncio.gather(*tasks)  # type: ignore[assignment]

    auto_apply_counts = await run_auto_apply_queue(profile)

    counts = {
        "scored": results.count("scored"),
        "priority": results.count("priority"),
        "filtered": results.count("filtered"),
        "failed": results.count("failed"),
        "applied": auto_apply_counts["applied"],
        "dry_run": auto_apply_counts["dry_run"],
        "apply_failed": auto_apply_counts["failed"],
    }
    counts["remaining"] = max(0, total_unscored - len(unscored))
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
    logger.info("  Auto-applied       : %d", counts.get("applied", 0))
    logger.info("  Auto-apply dry run : %d", counts.get("dry_run", 0))
    logger.info("  Auto-apply failed  : %d", counts.get("apply_failed", 0))
    logger.info("  Remaining queue    : %d", counts.get("remaining", 0))
    logger.info("=" * 60)
    logger.info("  Run the dashboard: streamlit run dashboard/app.py")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
