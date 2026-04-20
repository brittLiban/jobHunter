"""
tracker/tracker.py - Application lifecycle management.

All state transitions go through this module so the pipeline and dashboard
share a single source of truth for pipeline and manual updates.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any

from database.db import update_application

logger = logging.getLogger(__name__)

VALID_STATUSES = frozenset(
    {
        "found",
        "scored",
        "filtered",
        "applied",
        "rejected",
        "interview",
        "offer",
        "skipped",
    }
)


def _encode_payloads(**payloads: Any) -> dict[str, str]:
    return {
        key: json.dumps(value)
        for key, value in payloads.items()
        if value is not None
    }


def log_extraction(app_id: int, extracted_payload: dict) -> None:
    """Persist extraction results without advancing to the scored state."""
    update_application(
        app_id,
        **_encode_payloads(extracted_data=extracted_payload),
    )
    logger.info("[Tracker] app=%d extraction saved", app_id)


def log_score(
    app_id: int,
    score: int,
    apply: bool,
    scorer_payload: dict,
    is_priority: bool = False,
) -> None:
    """Persist scoring results and advance status to scored."""
    update_application(
        app_id,
        fit_score=score,
        apply_decision=int(apply),
        status="scored",
        **_encode_payloads(scorer_data=scorer_payload),
    )
    tag = " priority" if is_priority else ""
    logger.info("[Tracker] app=%d score=%d%s", app_id, score, tag)


def log_filtered(app_id: int, reason: str, **payloads: Any) -> None:
    """Mark a job as auto-filtered and persist any related payloads."""
    update_application(
        app_id,
        status="filtered",
        notes=f"Auto-filtered: {reason}",
        **_encode_payloads(**payloads),
    )
    logger.info("[Tracker] app=%d filtered - %s", app_id, reason)


def log_failure(app_id: int, reason: str, **payloads: Any) -> None:
    """Persist failed LLM payloads and mark the application as filtered."""
    update_application(
        app_id,
        status="filtered",
        notes=f"Pipeline failed: {reason}",
        **_encode_payloads(**payloads),
    )
    logger.info("[Tracker] app=%d failed - %s", app_id, reason)


def log_tailor(
    app_id: int,
    tailored_summary: str,
    cover_letter: str,
    tailor_payload: dict,
) -> None:
    """Persist tailored materials for a priority job."""
    update_application(
        app_id,
        tailored_summary=tailored_summary,
        cover_letter=cover_letter,
        **_encode_payloads(tailor_data=tailor_payload),
    )
    logger.info("[Tracker] app=%d tailored materials saved", app_id)


def log_apply_success(
    app_id: int,
    apply_payload: dict,
    notes: str = "",
) -> None:
    """Persist a successful auto-apply submission and mark the job applied."""
    kwargs: dict[str, Any] = {
        "status": "applied",
        "applied_at": datetime.now(tz=timezone.utc).isoformat(),
        **_encode_payloads(apply_data=apply_payload),
    }
    if notes:
        kwargs["notes"] = notes

    update_application(app_id, **kwargs)
    logger.info("[Tracker] app=%d auto-apply submitted", app_id)


def log_apply_failure(
    app_id: int,
    reason: str,
    apply_payload: dict,
) -> None:
    """
    Persist a failed auto-apply attempt without losing the scored state.

    The application stays in the scored queue so the user can retry manually
    after adjusting profile defaults or fixing site-specific issues.
    """
    retryable = bool(apply_payload.get("retryable", True))
    note_prefix = "Auto-apply failed" if retryable else "Auto-apply blocked"
    update_application(
        app_id,
        status="scored",
        notes=f"{note_prefix}: {reason}",
        **_encode_payloads(apply_data=apply_payload),
    )
    logger.info("[Tracker] app=%d %s - %s", app_id, note_prefix.lower(), reason)


def log_apply_dry_run(app_id: int, apply_payload: dict) -> None:
    """Persist a dry-run result without changing the scored/applied state."""
    update_application(
        app_id,
        status="scored",
        notes="Auto-apply dry run completed.",
        **_encode_payloads(apply_data=apply_payload),
    )
    logger.info("[Tracker] app=%d auto-apply dry run saved", app_id)


def update_status(
    app_id: int | None,
    status: str,
    notes: str = "",
    follow_up_date: str | None = None,
) -> None:
    """
    Manually advance an application's status.

    Sets applied_at automatically when status is applied.
    """
    if app_id is None:
        logger.error("[Tracker] Cannot update status for a missing application row")
        return

    if status not in VALID_STATUSES:
        logger.error("[Tracker] Invalid status '%s' for app=%d", status, app_id)
        return

    kwargs: dict[str, Any] = {"status": status}
    if notes:
        kwargs["notes"] = notes
    if follow_up_date:
        kwargs["follow_up_date"] = follow_up_date
    if status == "applied":
        kwargs["applied_at"] = datetime.now(tz=timezone.utc).isoformat()

    update_application(app_id, **kwargs)
    logger.info("[Tracker] app=%d status -> %s", app_id, status)
