"""
submitter/base.py - Shared interfaces for application submitters.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field


class ApplyResult(BaseModel):
    source: str
    apply_url: str
    success: bool
    submitted: bool
    dry_run: bool
    retryable: bool = True
    error: str | None = None
    blocked_reason: str | None = None
    filled_fields: list[str] = Field(default_factory=list)
    skipped_optional_fields: list[str] = Field(default_factory=list)
    unknown_required_fields: list[str] = Field(default_factory=list)
    missing_profile_fields: list[str] = Field(default_factory=list)
    resolver_data: dict | None = None
    confirmation_text: str | None = None


class BaseJobSubmitter(ABC):
    SOURCE_NAME: str = "unknown"

    @abstractmethod
    async def apply_to_job(
        self,
        job: dict,
        profile: dict,
        dry_run: bool = False,
    ) -> ApplyResult:
        """Submit or dry-run an application for a single job."""
