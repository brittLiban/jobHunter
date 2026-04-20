"""
llm/scorer.py - Score a job against the candidate's resume.

Each call validates the returned JSON with Pydantic. On validation failure,
the module retries once with a stricter prompt and returns the attempt log.
"""
import json
import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .client import call_ollama

logger = logging.getLogger(__name__)


class JobScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=0, le=100)
    apply: bool
    match_reasons: list[str] = Field(default_factory=list)
    gap_reasons: list[str] = Field(default_factory=list)
    one_line_summary: str


_PROMPT_1 = """\
You are evaluating whether this candidate should apply to the role.

Return ONLY a single JSON object with exactly these keys:
- score: integer 0-100
- apply: boolean
- match_reasons: array of strings
- gap_reasons: array of strings
- one_line_summary: string

Candidate Resume:
{resume_text}

Full Job Description:
{description}

Job Title: {title}
Company: {company}
"""

_PROMPT_2 = """\
Return ONLY valid JSON. No markdown. No commentary.

JSON schema:
{{
  "score": 0,
  "apply": false,
  "match_reasons": ["string"],
  "gap_reasons": ["string"],
  "one_line_summary": "string"
}}

Rules:
- score must be an integer from 0 to 100.
- apply must be true or false.
- match_reasons and gap_reasons must each be arrays of strings.
- one_line_summary must be one sentence.
- Use the full resume and the full job description.

Candidate Resume:
{resume_text}

Full Job Description:
{description}

Job Title: {title}
Company: {company}
"""


async def score_job(
    resume_text: str,
    title: str,
    company: str,
    description: str,
) -> tuple[JobScore | None, dict[str, Any]]:
    """Score with up to two attempts and return the attempt log."""
    attempts: list[dict[str, Any]] = []

    kwargs = {
        "resume_text": resume_text,
        "title": title,
        "company": company,
        "description": description,
    }

    raw = await _safe_call(_PROMPT_1.format(**kwargs))
    result, error = _parse(raw)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {"result": result.model_dump(), "attempts": attempts}

    logger.warning("[Scorer] Retrying with strict prompt")
    raw2 = await _safe_call(_PROMPT_2.format(**kwargs))
    result2, error2 = _parse(raw2)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {"result": result2.model_dump(), "attempts": attempts}

    logger.error("[Scorer] Both attempts failed")
    return None, {"result": None, "attempts": attempts}


async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Scorer] Ollama call failed: %s", exc)
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


def _parse(raw: str) -> tuple[JobScore | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"

    try:
        return JobScore.model_validate(data, strict=True), None
    except ValidationError as exc:
        return None, f"validation_error: {exc}"
