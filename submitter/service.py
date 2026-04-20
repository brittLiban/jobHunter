"""
submitter/service.py - Source-aware submission dispatch.
"""
from __future__ import annotations

from submitter.base import ApplyResult
from submitter.greenhouse import GreenhouseSubmitter


def supports_auto_apply(job: dict) -> bool:
    source = (job.get("source") or "").strip().lower()
    url = (job.get("url") or "").strip().lower()
    return source == "greenhouse" or "greenhouse" in url or "gh_jid=" in url


async def auto_apply_job(
    job: dict,
    profile: dict,
    dry_run: bool = False,
) -> ApplyResult:
    source = (job.get("source") or "").strip().lower()
    if supports_auto_apply(job):
        return await GreenhouseSubmitter().apply_to_job(job, profile, dry_run=dry_run)

    return ApplyResult(
        source=source or "unknown",
        apply_url="",
        success=False,
        submitted=False,
        dry_run=dry_run,
        retryable=False,
        error=f"No submitter is registered for source={source!r}.",
        blocked_reason="unsupported_source",
    )
