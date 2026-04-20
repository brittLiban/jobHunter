"""
llm/extractor.py — Extract structured metadata from a raw job description.

Two-attempt strategy:
  1. First attempt with a clear, example-driven prompt.
  2. On Pydantic validation failure, retry with a strict minimal prompt.
  3. If both fail, return None and let the pipeline mark the job as failed.
"""
import json
import logging
from typing import Optional

from pydantic import BaseModel, field_validator

from .client import call_ollama

logger = logging.getLogger(__name__)

# ── Pydantic model ────────────────────────────────────────────────────────────

class ExtractedJob(BaseModel):
    required_skills: list[str] = []
    years_experience: Optional[int] = None
    is_remote: bool = False
    is_contract: bool = False
    requires_sponsorship: bool = False
    seniority: str = "mid"

    @field_validator("seniority")
    @classmethod
    def validate_seniority(cls, v: str) -> str:
        return v if v in ("entry", "mid", "senior") else "mid"

    @field_validator("years_experience", mode="before")
    @classmethod
    def coerce_years(cls, v) -> Optional[int]:
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None


# ── Prompts ───────────────────────────────────────────────────────────────────

_PROMPT_1 = """\
Extract structured information from the job description below.

Return ONLY a single JSON object — no markdown, no explanation.

Required fields and types:
  "required_skills"       : array of strings  (technical skills explicitly listed)
  "years_experience"      : integer or null    (minimum years stated; null if not mentioned)
  "is_remote"             : boolean            (true if remote work is offered)
  "is_contract"           : boolean            (true if contract/freelance; false if full-time)
  "requires_sponsorship"  : boolean            (true ONLY if the posting explicitly says it \
cannot sponsor work authorization; false otherwise)
  "seniority"             : "entry" | "mid" | "senior"

Job Description (first 3000 chars):
{description}
"""

_PROMPT_2 = """\
Return ONLY a JSON object with these exact keys. No other text.

required_skills (string array), years_experience (int or null),
is_remote (bool), is_contract (bool), requires_sponsorship (bool),
seniority ("entry"|"mid"|"senior").

IMPORTANT: requires_sponsorship should be true ONLY if the job explicitly \
says it cannot sponsor visas. If unsure, use false.

Job text:
{description}

JSON:"""


# ── Public API ────────────────────────────────────────────────────────────────

async def extract_job_data(description: str) -> ExtractedJob | None:
    """
    Run extraction with up to two attempts.  Returns None on total failure.
    """
    snippet = description[:3000]

    # Attempt 1
    raw = await _safe_call(_PROMPT_1.format(description=snippet))
    result = _parse(raw, attempt=1)
    if result:
        return result

    # Attempt 2 — stricter prompt
    logger.warning("[Extractor] Retrying with strict prompt…")
    raw2 = await _safe_call(_PROMPT_2.format(description=snippet))
    result2 = _parse(raw2, attempt=2)
    if result2:
        return result2

    logger.error("[Extractor] Both attempts failed — skipping job")
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Extractor] Ollama call failed: %s", exc)
        return ""


def _parse(raw: str, attempt: int) -> ExtractedJob | None:
    try:
        data = json.loads(raw)
        return ExtractedJob(**data)
    except json.JSONDecodeError as exc:
        logger.warning("[Extractor] attempt %d — JSON parse error: %s", attempt, exc)
    except Exception as exc:
        logger.warning("[Extractor] attempt %d — validation error: %s", attempt, exc)
    return None
