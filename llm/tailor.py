"""
llm/tailor.py — Two separate LLM calls for priority jobs (score >= 80):

  1. tailor_resume()   — Rewrite top 3 resume bullets + suggested summary.
  2. generate_answers() — Why this role, why hire me, short cover letter.
"""
import json
import logging

from pydantic import BaseModel, field_validator

from .client import call_ollama

logger = logging.getLogger(__name__)

# ── Pydantic models ───────────────────────────────────────────────────────────

class TailoredResume(BaseModel):
    tailored_bullets: list[str]
    suggested_summary: str

    @field_validator("tailored_bullets", mode="before")
    @classmethod
    def ensure_three_bullets(cls, v) -> list[str]:
        if not isinstance(v, list):
            return ["", "", ""]
        padded = list(v) + [""] * 3
        return [str(b) for b in padded[:3]]


class ApplicationAnswers(BaseModel):
    why_role: str
    why_hire: str
    cover_letter_short: str

    @field_validator("why_role", "why_hire", "cover_letter_short", mode="before")
    @classmethod
    def coerce_str(cls, v) -> str:
        return str(v) if v is not None else ""


# ── Prompts ───────────────────────────────────────────────────────────────────

_BULLETS_PROMPT_1 = """\
You are a professional resume writer. Rewrite the candidate's top 3 resume
bullets to match the keywords and priorities in the job description below.
Keep each bullet to one line, starting with a strong action verb, and include
a quantified result where possible.

Candidate Resume:
{resume}

Target Job Description:
{description}

Return ONLY a single JSON object:
{{
  "tailored_bullets"  : ["bullet 1", "bullet 2", "bullet 3"],
  "suggested_summary" : "2-3 sentence professional summary tailored to this role"
}}
"""

_BULLETS_PROMPT_2 = """\
Return ONLY JSON. No other text.
Rewrite 3 resume bullets for this job. Keep them concise with metrics.

Resume: {resume}
Job:    {description}

Required JSON: tailored_bullets (array of 3 strings), suggested_summary (string).
JSON:"""

_ANSWERS_PROMPT_1 = """\
You are a career coach helping a candidate craft their application.

Candidate Resume:
{resume}

Job Title   : {title}
Company     : {company}
Job Description:
{description}

Return ONLY a single JSON object:
{{
  "why_role"           : "2-3 sentences explaining genuine interest in this specific role",
  "why_hire"           : "2-3 sentences on why the candidate is the best fit",
  "cover_letter_short" : "concise 3-paragraph cover letter under 280 words"
}}
"""

_ANSWERS_PROMPT_2 = """\
Return ONLY JSON. No explanation.
Fields: why_role (string), why_hire (string), cover_letter_short (string).

Resume: {resume}
Job: {title} at {company}
Description: {description}

JSON:"""


# ── Public API ────────────────────────────────────────────────────────────────

async def tailor_resume(resume: str, description: str) -> TailoredResume | None:
    """Rewrite top 3 bullets and generate a tailored summary. Two attempts."""
    kwargs = dict(resume=resume[:2000], description=description[:2000])

    raw = await _safe_call(_BULLETS_PROMPT_1.format(**kwargs))
    result = _parse_bullets(raw, attempt=1)
    if result:
        return result

    logger.warning("[Tailor/Bullets] Retrying…")
    raw2 = await _safe_call(_BULLETS_PROMPT_2.format(**kwargs))
    result2 = _parse_bullets(raw2, attempt=2)
    if result2:
        return result2

    logger.error("[Tailor/Bullets] Both attempts failed")
    return None


async def generate_answers(
    resume: str,
    title: str,
    company: str,
    description: str,
) -> ApplicationAnswers | None:
    """Generate why_role, why_hire, and cover_letter_short. Two attempts."""
    kwargs = dict(
        resume=resume[:2000],
        title=title,
        company=company,
        description=description[:2000],
    )

    raw = await _safe_call(_ANSWERS_PROMPT_1.format(**kwargs))
    result = _parse_answers(raw, attempt=1)
    if result:
        return result

    logger.warning("[Tailor/Answers] Retrying…")
    kwargs["resume"] = resume[:1200]
    kwargs["description"] = description[:1200]
    raw2 = await _safe_call(_ANSWERS_PROMPT_2.format(**kwargs))
    result2 = _parse_answers(raw2, attempt=2)
    if result2:
        return result2

    logger.error("[Tailor/Answers] Both attempts failed")
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Tailor] Ollama call failed: %s", exc)
        return ""


def _parse_bullets(raw: str, attempt: int) -> TailoredResume | None:
    try:
        return TailoredResume(**json.loads(raw))
    except json.JSONDecodeError as exc:
        logger.warning("[Tailor/Bullets] attempt %d — JSON error: %s", attempt, exc)
    except Exception as exc:
        logger.warning("[Tailor/Bullets] attempt %d — validation error: %s", attempt, exc)
    return None


def _parse_answers(raw: str, attempt: int) -> ApplicationAnswers | None:
    try:
        return ApplicationAnswers(**json.loads(raw))
    except json.JSONDecodeError as exc:
        logger.warning("[Tailor/Answers] attempt %d — JSON error: %s", attempt, exc)
    except Exception as exc:
        logger.warning("[Tailor/Answers] attempt %d — validation error: %s", attempt, exc)
    return None
