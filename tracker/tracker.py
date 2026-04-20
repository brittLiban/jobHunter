"""
tracker/tracker.py — Application lifecycle management.

All state transitions go through this module so the pipeline and dashboard
share a single source of truth for what "scored", "filtered", etc. mean.
"""
import json
import logging
from datetime import datetime, timezone

from database.db import update_application

logger = logging.getLogger(__name__)

VALID_STATUSES = frozenset({
    "found", "scored", "filtered",
    "applied", "rejected", "interview", "offer", "skipped",
})

# ── Pipeline log helpers ───────────────────────────────────────────────────────

def log_extraction(app_id: int, extracted_data: dict) -> None:
    """Persist extraction results and advance status to 'scored'."""
    update_application(
        app_id,
        extracted_data=json.dumps(extracted_data),
        status="scored",
    )
    logger.info("[Tracker] app=%d  extraction saved", app_id)


def log_score(
    app_id: int,
    score: int,
    apply: bool,
    scorer_data: dict,
    is_priority: bool = False,
) -> None:
    """Persist scoring results. Priority jobs get a note flag."""
    notes = "PRIORITY" if is_priority else ""
    update_application(
        app_id,
        fit_score=score,
        apply_decision=int(apply),
        scorer_data=json.dumps(scorer_data),
        status="scored",
        notes=notes,
    )
    tag = " *** PRIORITY ***" if is_priority else ""
    logger.info("[Tracker] app=%d  score=%d%s", app_id, score, tag)


def log_filtered(app_id: int, reason: str) -> None:
    """Mark job as auto-filtered and record the reason."""
    update_application(app_id, status="filtered", notes=f"Auto-filtered: {reason}")
    logger.info("[Tracker] app=%d  filtered — %s", app_id, reason)


def log_tailor(
    app_id: int,
    tailored_summary: str,
    cover_letter: str,
    tailor_data: dict,
) -> None:
    """Persist tailored materials for a priority job."""
    update_application(
        app_id,
        tailored_summary=tailored_summary,
        cover_letter=cover_letter,
        tailor_data=json.dumps(tailor_data),
    )
    logger.info("[Tracker] app=%d  tailored materials saved", app_id)


# ── Dashboard / manual status updates ────────────────────────────────────────

def update_status(app_id: int, status: str, notes: str = "") -> None:
    """
    Manually advance an application's status (called from the dashboard or CLI).
    Sets applied_at timestamp automatically when status = 'applied'.
    """
    if status not in VALID_STATUSES:
        logger.error("[Tracker] Invalid status '%s' for app=%d", status, app_id)
        return

    kwargs: dict = {"status": status}
    if notes:
        kwargs["notes"] = notes
    if status == "applied":
        kwargs["applied_at"] = datetime.now(tz=timezone.utc).isoformat()

    update_application(app_id, **kwargs)
    logger.info("[Tracker] app=%d  status → %s", app_id, status)
