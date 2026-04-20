"""
llm/tailor.py - Tailor resume content and application answers for priority jobs.

Each call validates the returned JSON with Pydantic. On validation failure,
the module retries once with a stricter prompt and returns the attempt log.
"""
import json
import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from .client import call_ollama

logger = logging.getLogger(__name__)


class TailoredResume(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tailored_bullets: list[str]
    suggested_summary: str

    @field_validator("tailored_bullets")
    @classmethod
    def validate_bullet_count(cls, value: list[str]) -> list[str]:
        if len(value) != 3:
            raise ValueError("tailored_bullets must contain exactly 3 items")
        return value


class ApplicationAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    why_role: str
    why_hire: str
    cover_letter_short: str


_BULLETS_PROMPT_1 = """\
Rewrite the candidate's top 3 resume bullets so they align with the role.

Return ONLY a single JSON object with exactly these keys:
- tailored_bullets: array of exactly 3 strings
- suggested_summary: string

Candidate Resume:
{resume_text}

Full Job Description:
{description}
"""

_BULLETS_PROMPT_2 = """\
Return ONLY valid JSON. No markdown. No commentary.

JSON schema:
{{
  "tailored_bullets": ["string", "string", "string"],
  "suggested_summary": "string"
}}

Rules:
- tailored_bullets must contain exactly 3 strings.
- suggested_summary must be a concise summary for this job.
- Use the full resume and the full job description.

Candidate Resume:
{resume_text}

Full Job Description:
{description}
"""

_ANSWERS_PROMPT_1 = """\
Write concise application materials for this role.

Return ONLY a single JSON object with exactly these keys:
- why_role: string
- why_hire: string
- cover_letter_short: string

Candidate Resume:
{resume_text}

Full Job Description:
{description}

Job Title: {title}
Company: {company}
"""

_ANSWERS_PROMPT_2 = """\
Return ONLY valid JSON. No markdown. No commentary.

JSON schema:
{{
  "why_role": "string",
  "why_hire": "string",
  "cover_letter_short": "string"
}}

Rules:
- All values must be strings.
- cover_letter_short should stay concise.
- Use the full resume and the full job description.

Candidate Resume:
{resume_text}

Full Job Description:
{description}

Job Title: {title}
Company: {company}
"""


async def tailor_resume(
    resume_text: str,
    description: str,
) -> tuple[TailoredResume | None, dict[str, Any]]:
    """Rewrite top 3 bullets and generate a tailored summary."""
    attempts: list[dict[str, Any]] = []
    kwargs = {"resume_text": resume_text, "description": description}

    raw = await _safe_call(_BULLETS_PROMPT_1.format(**kwargs))
    result, error = _parse_bullets(raw)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {"result": result.model_dump(), "attempts": attempts}

    logger.warning("[Tailor/Bullets] Retrying with strict prompt")
    raw2 = await _safe_call(_BULLETS_PROMPT_2.format(**kwargs))
    result2, error2 = _parse_bullets(raw2)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {"result": result2.model_dump(), "attempts": attempts}

    logger.error("[Tailor/Bullets] Both attempts failed")
    return None, {"result": None, "attempts": attempts}


async def generate_answers(
    resume_text: str,
    title: str,
    company: str,
    description: str,
) -> tuple[ApplicationAnswers | None, dict[str, Any]]:
    """Generate why_role, why_hire, and cover_letter_short."""
    attempts: list[dict[str, Any]] = []
    kwargs = {
        "resume_text": resume_text,
        "title": title,
        "company": company,
        "description": description,
    }

    raw = await _safe_call(_ANSWERS_PROMPT_1.format(**kwargs))
    result, error = _parse_answers(raw)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {"result": result.model_dump(), "attempts": attempts}

    logger.warning("[Tailor/Answers] Retrying with strict prompt")
    raw2 = await _safe_call(_ANSWERS_PROMPT_2.format(**kwargs))
    result2, error2 = _parse_answers(raw2)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {"result": result2.model_dump(), "attempts": attempts}

    logger.error("[Tailor/Answers] Both attempts failed")
    return None, {"result": None, "attempts": attempts}


async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Tailor] Ollama call failed: %s", exc)
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


def _parse_bullets(raw: str) -> tuple[TailoredResume | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"

    try:
        return TailoredResume.model_validate(data, strict=True), None
    except ValidationError as exc:
        return None, f"validation_error: {exc}"


def _parse_answers(raw: str) -> tuple[ApplicationAnswers | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"

    try:
        return ApplicationAnswers.model_validate(data, strict=True), None
    except ValidationError as exc:
        return None, f"validation_error: {exc}"
