"""
llm/extractor.py - Extract structured metadata from a raw job description.

Each call validates the returned JSON with Pydantic. On validation failure,
the module retries once with a stricter prompt and returns the attempt log.
"""
import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .client import call_ollama

logger = logging.getLogger(__name__)


class ExtractedJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    required_skills: list[str] = Field(default_factory=list)
    years_experience: int | None = None
    is_remote: bool
    is_contract: bool
    requires_sponsorship: bool
    seniority: Literal["entry", "mid", "senior"]


_PROMPT_1 = """\
Extract structured information from the job description below.

Return ONLY a single JSON object with exactly these keys:
- required_skills: array of strings
- years_experience: integer or null
- is_remote: boolean
- is_contract: boolean
- requires_sponsorship: boolean
- seniority: "entry" | "mid" | "senior"

Use the candidate resume only as context. Do not infer anything that is not
stated in the job description.

Candidate Resume:
{resume_text}

Full Job Description:
{description}
"""

_PROMPT_2 = """\
Return ONLY valid JSON. No markdown. No commentary.

JSON schema:
{{
  "required_skills": ["string"],
  "years_experience": 0,
  "is_remote": true,
  "is_contract": false,
  "requires_sponsorship": false,
  "seniority": "entry"
}}

Rules:
- Use null for years_experience if it is not explicitly stated.
- requires_sponsorship is true ONLY when the job explicitly says sponsorship
  or work authorization support is required or unavailable.
- Use only "entry", "mid", or "senior" for seniority.
- Use the full job description as the source of truth.

Candidate Resume:
{resume_text}

Full Job Description:
{description}
"""


async def extract_job_data(
    resume_text: str,
    description: str,
) -> tuple[ExtractedJob | None, dict[str, Any]]:
    """Run extraction with up to two attempts and return the attempt log."""
    attempts: list[dict[str, Any]] = []

    raw = await _safe_call(_PROMPT_1.format(resume_text=resume_text, description=description))
    result, error = _parse(raw)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {"result": result.model_dump(), "attempts": attempts}

    logger.warning("[Extractor] Retrying with strict prompt")
    raw2 = await _safe_call(_PROMPT_2.format(resume_text=resume_text, description=description))
    result2, error2 = _parse(raw2)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {"result": result2.model_dump(), "attempts": attempts}

    logger.error("[Extractor] Both attempts failed")
    return None, {"result": None, "attempts": attempts}


async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Extractor] Ollama call failed: %s", exc)
        return ""


def _attempt_log(
    attempt: int,
    variant: str,
    raw_response: str,
    error: str | None,
) -> dict[str, Any]:
    return {
        "attempt": attempt,
        "variant": variant,
        "validated": error is None,
        "error": error,
        "raw_response": raw_response,
    }


def _parse(raw: str) -> tuple[ExtractedJob | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"

    try:
        return ExtractedJob.model_validate(data, strict=True), None
    except ValidationError as exc:
        return None, f"validation_error: {exc}"
