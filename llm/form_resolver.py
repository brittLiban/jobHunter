"""
llm/form_resolver.py - Resolve application form questions against known profile data.

The resolver uses the local LLM to normalize semantically similar question labels
to existing candidate facts or generated materials. It is intentionally
conservative: when the answer is not grounded in explicit profile data or
generated fit text, it returns a non-autofillable result instead of guessing.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .client import call_ollama

logger = logging.getLogger(__name__)


class ResolvedFormQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    answer: str | None = None
    safe_to_autofill: bool
    answer_source: Literal["profile", "generated_material", "custom_answer", "unknown"]
    reason: str = ""


class FormResolutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolutions: list[ResolvedFormQuestion] = Field(default_factory=list)


_PROMPT_1 = """\
Map application form questions to known candidate facts.

Return ONLY a single JSON object with exactly this shape:
{{
  "resolutions": [
    {{
      "label": "string",
      "answer": "string or null",
      "safe_to_autofill": true,
      "answer_source": "profile" | "generated_material" | "custom_answer" | "unknown",
      "reason": "string"
    }}
  ]
}}

Rules:
- Produce one resolution object for every question in unresolved_questions.
- Only provide an answer when it is grounded in known_profile_values or generated_materials.
- For open-text motivation / fit questions, you may use generated_materials.
- Never invent or guess answers for legal, immigration, employment-history, prior-application,
  non-compete, relocation, citizenship, or company-familiarity questions unless a matching
  answer already exists in known_profile_values.
- If no safe grounded answer exists, set answer to null and safe_to_autofill to false.
- Keep answers concise and form-ready.

Job:
{job_context}

Known profile values:
{known_profile_values}

Generated materials:
{generated_materials}

Unresolved questions:
{unresolved_questions}
"""

_PROMPT_2 = """\
Return ONLY valid JSON. No markdown. No commentary.

JSON schema:
{{
  "resolutions": [
    {{
      "label": "string",
      "answer": "string or null",
      "safe_to_autofill": true,
      "answer_source": "profile",
      "reason": "string"
    }}
  ]
}}

Rules:
- Emit one object per unresolved question.
- Copy the exact label from unresolved_questions into each object.
- If the answer is not explicitly grounded in known_profile_values or generated_materials,
  return answer=null and safe_to_autofill=false.
- Use answer_source="generated_material" only for short open-text fit or motivation answers.
- Use answer_source="custom_answer" only when the answer clearly comes from custom_question_answers.
- Never guess factual legal/employment/application history answers.

Job:
{job_context}

Known profile values:
{known_profile_values}

Generated materials:
{generated_materials}

Unresolved questions:
{unresolved_questions}
"""


async def resolve_form_questions(
    unresolved_questions: list[str],
    defaults: dict[str, Any],
    job: dict[str, Any],
    profile: dict[str, Any],
) -> tuple[FormResolutionResult | None, dict[str, Any]]:
    """Use the LLM to resolve unresolved required form questions conservatively."""
    attempts: list[dict[str, Any]] = []
    if not unresolved_questions:
        empty = FormResolutionResult(resolutions=[])
        return empty, {"result": empty.model_dump(), "attempts": attempts}

    context = {
        "job_context": json.dumps(
            {
                "title": job.get("title") or "",
                "company": job.get("company") or "",
                "source": job.get("source") or "",
            }
        ),
        "known_profile_values": json.dumps(_known_profile_values(defaults, profile), ensure_ascii=True),
        "generated_materials": json.dumps(_generated_materials(defaults, job, profile), ensure_ascii=True),
        "unresolved_questions": json.dumps(unresolved_questions, ensure_ascii=True),
    }

    raw = await _safe_call(_PROMPT_1.format(**context))
    result, error = _parse(raw, unresolved_questions)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {"result": result.model_dump(), "attempts": attempts}

    logger.warning("[FormResolver] Retrying with strict prompt")
    raw2 = await _safe_call(_PROMPT_2.format(**context))
    result2, error2 = _parse(raw2, unresolved_questions)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {"result": result2.model_dump(), "attempts": attempts}

    logger.error("[FormResolver] Both attempts failed")
    return None, {"result": None, "attempts": attempts}


def _known_profile_values(defaults: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    prefs = profile.get("preferences_json", {}) if isinstance(profile.get("preferences_json"), dict) else {}
    filtered: dict[str, Any] = {}
    for key, value in defaults.items():
        if key == "custom_question_answers":
            continue
        if isinstance(value, (str, int, float)) and str(value).strip():
            filtered[key] = value
        elif isinstance(value, list) and value:
            filtered[key] = value

    custom_answers = defaults.get("custom_question_answers")
    if isinstance(custom_answers, list) and custom_answers:
        filtered["custom_question_answers"] = custom_answers

    citizenship = prefs.get("citizenship")
    if citizenship and not filtered.get("citizenship"):
        filtered["citizenship"] = citizenship
    return filtered


def _generated_materials(defaults: dict[str, Any], job: dict[str, Any], profile: dict[str, Any]) -> dict[str, str]:
    prefs = profile.get("preferences_json", {}) if isinstance(profile.get("preferences_json"), dict) else {}
    materials: dict[str, str] = {}
    for key in ("why_fit",):
        value = defaults.get(key)
        if isinstance(value, str) and value.strip():
            materials[key] = value.strip()

    candidate_summary = prefs.get("candidate_profile_summary")
    if isinstance(candidate_summary, str) and candidate_summary.strip():
        materials["candidate_profile_summary"] = candidate_summary.strip()

    tailored_summary = job.get("tailored_summary")
    if isinstance(tailored_summary, str) and tailored_summary.strip():
        materials["tailored_summary"] = tailored_summary.strip()

    cover_letter = job.get("cover_letter")
    if isinstance(cover_letter, str) and cover_letter.strip():
        materials["cover_letter"] = cover_letter.strip()
    return materials


async def _safe_call(prompt: str) -> str:
    try:
        return await call_ollama(prompt)
    except Exception as exc:
        logger.error("[FormResolver] Ollama call failed: %s", exc)
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


def _parse(
    raw: str,
    unresolved_questions: list[str],
) -> tuple[FormResolutionResult | None, str | None]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"

    if isinstance(data, dict):
        data = _normalize_resolution_payload(data, unresolved_questions)

    try:
        parsed = FormResolutionResult.model_validate(data, strict=True)
    except ValidationError as exc:
        return None, f"validation_error: {exc}"

    labels = {item.label for item in parsed.resolutions}
    missing = [label for label in unresolved_questions if label not in labels]
    if missing:
        return None, f"validation_error: missing resolutions for labels {missing}"
    return parsed, None


def _normalize_resolution_payload(
    data: dict[str, Any],
    unresolved_questions: list[str],
) -> dict[str, Any]:
    resolutions = data.get("resolutions")
    if not isinstance(resolutions, list):
        return data

    normalized_questions = {
        _normalize_label(label): label for label in unresolved_questions
    }
    answer_source_aliases = {
        "known_profile_values": "profile",
        "known_profile": "profile",
        "profile_data": "profile",
        "generated_materials": "generated_material",
        "generated": "generated_material",
        "custom_question_answers": "custom_answer",
        "custom_answers": "custom_answer",
    }

    cleaned: list[dict[str, Any]] = []
    for item in resolutions:
        if not isinstance(item, dict):
            cleaned.append(item)
            continue

        normalized = dict(item)
        label = str(normalized.get("label") or "").strip()
        canonical_label = normalized_questions.get(_normalize_label(label))
        if canonical_label:
            normalized["label"] = canonical_label

        answer_source = str(normalized.get("answer_source") or "").strip().lower()
        if answer_source in answer_source_aliases:
            normalized["answer_source"] = answer_source_aliases[answer_source]

        answer = normalized.get("answer")
        if isinstance(answer, str):
            answer = answer.strip()
            normalized["answer"] = answer or None
        if not normalized.get("answer"):
            normalized["safe_to_autofill"] = False

        cleaned.append(normalized)

    return {**data, "resolutions": cleaned}


def _normalize_label(text: str) -> str:
    return " ".join(str(text).strip().lower().split())
