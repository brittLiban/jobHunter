"""
llm/scorer.py — Score a job against the candidate's resume.

Returns a JobScore with a 0-100 integer score, an apply recommendation,
match reasons, gap reasons, and a one-line summary.
"""
import json
import logging
from typing import Optional

from pydantic import BaseModel, field_validator

from .client import call_ollama

logger = logging.getLogger(__name__)

# ── Pydantic model ────────────────────────────────────────────────────────────

class JobScore(BaseModel):
    score: int
    apply: bool
    match_reasons: list[str] = []
    gap_reasons: list[str] = []
    one_line_summary: str = ""

    @field_validator("score", mode="before")
    @classmethod
    def clamp_score(cls, v) -> int:
        try:
            return max(0, min(100, int(v)))
        except (TypeError, ValueError):
            return 0

    @field_validator("match_reasons", "gap_reasons", mode="before")
    @classmethod
    def ensure_list(cls, v) -> list:
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            return [v]
        return []


# ── Prompts ───────────────────────────────────────────────────────────────────

_PROMPT_1 = """\
You are a senior recruiter. Score how well this candidate matches the job.

Scoring rubric:
  90-100 : Excellent — strong match on skills, experience level, and domain.
  70-89  : Good — most requirements met with minor gaps.
  50-69  : Partial — some relevant experience but notable gaps.
  0-49   : Poor — significant mismatch.

Candidate Resume:
{resume}

Job Title   : {title}
Company     : {company}
Job Description:
{description}

Return ONLY a single JSON object:
{{
  "score"           : integer 0-100,
  "apply"           : true or false,
  "match_reasons"   : ["reason1", "reason2"],
  "gap_reasons"     : ["gap1", "gap2"],
  "one_line_summary": "one sentence summary of fit"
}}
"""

_PROMPT_2 = """\
Return ONLY JSON. No explanation.

Score this job-candidate match (0-100).
Fields: score (int), apply (bool), match_reasons (string[]),
gap_reasons (string[]), one_line_summary (string).

Resume (truncated):
{resume}

Job: {title} at {company}
Description:
{description}

JSON:"""


# ── Public API ────────────────────────────────────────────────────────────────

async def score_job(
    resume: str,
    title: str,
    company: str,
    description: str,
) -> JobScore | None:
    """Score with up to two attempts. Returns None on total failure."""
    kwargs = dict(
        resume=resume[:2000],
        title=title,
        company=company,
        description=description[:2000],
    )

    raw = await _safe_call(_PROMPT_1.format(**kwargs))
    result = _parse(raw, attempt=1)
    if result:
        return result

    logger.warning("[Scorer] Retrying with strict prompt…")
    kwargs["resume"] = resume[:1200]
    kwargs["description"] = description[:1200]
    raw2 = await _safe_call(_PROMPT_2.format(**kwargs))
    result2 = _parse(raw2, attempt=2)
    if result2:
        return result2

    logger.error("[Scorer] Both attempts failed")
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[Scorer] Ollama call failed: %s", exc)
        return ""


def _parse(raw: str, attempt: int) -> JobScore | None:
    try:
        data = json.loads(raw)
        return JobScore(**data)
    except json.JSONDecodeError as exc:
        logger.warning("[Scorer] attempt %d — JSON parse error: %s", attempt, exc)
    except Exception as exc:
        logger.warning("[Scorer] attempt %d — validation error: %s", attempt, exc)
    return None
