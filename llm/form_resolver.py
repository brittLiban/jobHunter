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
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .client import call_ollama

logger = logging.getLogger(__name__)

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_OPEN_TEXT_LABEL_PATTERNS = (
    "why",
    "motivation",
    "interested",
    "interest in",
    "tell us",
    "about you",
    "good fit",
    "fit for",
    "fit at",
    "summary",
    "additional information",
    "anything else",
    "cover letter",
    "what excites",
    "what draws you",
    "why do you want",
    "why are you",
    "why would you",
)
_PROFILE_KEY_LABEL_ALIASES: dict[str, tuple[str, ...]] = {
    "first_name": ("first name", "legal first name", "given name"),
    "last_name": ("last name", "family name", "surname"),
    "preferred_name": ("preferred name",),
    "email": ("email", "email address"),
    "phone": ("phone", "phone number", "mobile number"),
    "phone_country": ("phone country", "phone country code", "country code"),
    "country": ("country", "country where you currently reside", "country of residence"),
    "work_location_countries": (
        "country or countries you anticipate working in",
        "work location countries",
    ),
    "location_city": ("city", "current city", "location city"),
    "city_state": ("city and state", "city state"),
    "gender": ("gender",),
    "pronouns": ("pronouns",),
    "veteran_status": ("veteran", "veteran status"),
    "disability_status": ("disability", "disability status"),
    "work_authorization_us": (
        "authorized to work",
        "work authorization",
        "legally authorized to work",
    ),
    "requires_sponsorship_now_or_future": (
        "require sponsorship",
        "needs sponsorship",
        "work permit sponsorship",
        "immigration support",
    ),
    "current_or_previous_employer": ("current or previous employer", "previous employer"),
    "current_or_previous_job_title": (
        "current or previous job title",
        "previous job title",
        "job title",
    ),
    "plans_remote_if_available": ("plan to work remotely", "remote work"),
    "whatsapp_recruiting_opt_in": ("whatsapp", "whatsapp recruiting"),
    "school_name": (
        "school",
        "school name",
        "college",
        "university",
        "most recent school you attended",
    ),
    "degree": ("degree", "most recent degree you obtained"),
    "discipline": ("discipline", "field of study", "major"),
    "gpa": ("gpa",),
    "start_date_year": ("start date year", "start year"),
    "graduation_year": (
        "expected graduation year",
        "graduation year",
        "anticipated graduation year",
        "expected graduation date",
    ),
    "current_twitch_employee": ("currently a twitch employee", "current twitch employee"),
    "current_amazon_employee": ("current employee with amazon", "current amazon employee"),
    "previous_company_application": ("previously applied to", "previous application"),
    "previous_amazon_employment": (
        "previously been employed by amazon",
        "previous amazon employment",
    ),
    "open_to_relocation": ("open to relocation", "relocation"),
    "future_opportunities_opt_in": ("considered for future opportunities",),
    "non_compete_restriction": (
        "subject to a non competition agreement",
        "subject to a non compete agreement",
        "non competition agreement",
        "non compete agreement",
    ),
    "held_h1b_last_6_years": ("held h 1b status", "held h-1b status", "h1b petition"),
    "familiar_with_company": ("familiar with", "familiarity with company"),
    "legally_eligible_to_begin_immediately": (
        "legally eligible to begin employment immediately",
        "eligible to begin employment immediately",
    ),
    "needs_immigration_support_amazon": (
        "immigration related support or sponsorship from amazon",
        "need sponsorship from amazon",
    ),
    "country_of_citizenship": ("country of citizenship", "citizenship"),
}


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
- For profile or custom answers, copy the exact stored answer text instead of paraphrasing.
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
- For profile or custom answers, reuse the exact stored answer text.
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

    known_profile_values = _known_profile_values(defaults, profile)
    generated_materials = _generated_materials(defaults, job, profile)
    grounding_catalog = _grounding_catalog(known_profile_values, generated_materials)

    context = {
        "job_context": json.dumps(
            {
                "title": job.get("title") or "",
                "company": job.get("company") or "",
                "source": job.get("source") or "",
            }
        ),
        "known_profile_values": json.dumps(known_profile_values, ensure_ascii=True),
        "generated_materials": json.dumps(generated_materials, ensure_ascii=True),
        "unresolved_questions": json.dumps(unresolved_questions, ensure_ascii=True),
    }

    raw = await _safe_call(_PROMPT_1.format(**context))
    result, error = _parse(raw, unresolved_questions, grounding_catalog)
    attempts.append(_attempt_log(1, "default", raw, error))
    if result is not None:
        return result, {
            "result": result.model_dump(),
            "attempts": attempts,
            "grounding": grounding_catalog["summary"],
        }

    logger.warning("[FormResolver] Retrying with strict prompt")
    raw2 = await _safe_call(_PROMPT_2.format(**context))
    result2, error2 = _parse(raw2, unresolved_questions, grounding_catalog)
    attempts.append(_attempt_log(2, "strict", raw2, error2))
    if result2 is not None:
        return result2, {
            "result": result2.model_dump(),
            "attempts": attempts,
            "grounding": grounding_catalog["summary"],
        }

    logger.error("[FormResolver] Both attempts failed")
    return None, {"result": None, "attempts": attempts, "grounding": grounding_catalog["summary"]}


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


def _grounding_catalog(
    known_profile_values: dict[str, Any],
    generated_materials: dict[str, str],
) -> dict[str, Any]:
    profile_answers: list[dict[str, str]] = []
    custom_answers: list[dict[str, str]] = []

    for key, value in known_profile_values.items():
        if key == "custom_question_answers":
            continue
        if isinstance(value, (str, int, float)) and str(value).strip():
            profile_answers.append(
                {
                    "key": key,
                    "value": str(value).strip(),
                    "normalized": _normalize_label(value),
                    "aliases": _profile_key_aliases(key),
                }
            )
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, (str, int, float)) and str(item).strip():
                    profile_answers.append(
                        {
                            "key": key,
                            "value": str(item).strip(),
                            "normalized": _normalize_label(item),
                            "aliases": _profile_key_aliases(key),
                        }
                    )

    raw_custom_answers = known_profile_values.get("custom_question_answers")
    if isinstance(raw_custom_answers, list):
        for item in raw_custom_answers:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            value = str(item.get("value") or "").strip()
            if not label or not value:
                continue
            custom_answers.append(
                {
                    "label": label,
                    "label_normalized": _normalize_label(label),
                    "value": value,
                    "value_normalized": _normalize_label(value),
                }
            )

    generated_answers = [
        {
            "key": key,
            "value": value.strip(),
            "normalized": _normalize_free_text(value),
        }
        for key, value in generated_materials.items()
        if isinstance(value, str) and value.strip()
    ]

    return {
        "profile_answers": profile_answers,
        "custom_answers": custom_answers,
        "generated_answers": generated_answers,
        "summary": {
            "profile_answer_count": len(profile_answers),
            "custom_answer_count": len(custom_answers),
            "generated_material_count": len(generated_answers),
        },
    }


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
    grounding_catalog: dict[str, Any],
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

    parsed = _enforce_grounding(parsed, grounding_catalog)

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
    cleaned = _NON_ALNUM_RE.sub(" ", str(text).strip().lower())
    return " ".join(cleaned.split())


def _normalize_free_text(text: object) -> str:
    return " ".join(str(text).strip().lower().split())


def _enforce_grounding(
    parsed: FormResolutionResult,
    grounding_catalog: dict[str, Any],
) -> FormResolutionResult:
    grounded: list[ResolvedFormQuestion] = []
    for resolution in parsed.resolutions:
        grounded.append(_ground_resolution(resolution, grounding_catalog))
    return FormResolutionResult(resolutions=grounded)


def _ground_resolution(
    resolution: ResolvedFormQuestion,
    grounding_catalog: dict[str, Any],
) -> ResolvedFormQuestion:
    if not resolution.answer:
        return resolution.model_copy(
            update={
                "safe_to_autofill": False,
                "answer": None,
                "answer_source": "unknown",
                "reason": _reason_with_suffix(resolution.reason, "No grounded answer available."),
            }
        )

    label_normalized = _normalize_label(resolution.label)
    answer_normalized = _normalize_label(resolution.answer)
    free_answer_normalized = _normalize_free_text(resolution.answer)

    custom_match = _match_custom_answer(
        label_normalized,
        answer_normalized,
        grounding_catalog.get("custom_answers", []),
    )
    if custom_match is not None:
        return resolution.model_copy(
            update={
                "answer": custom_match["value"],
                "safe_to_autofill": True,
                "answer_source": "custom_answer",
                "reason": _reason_with_suffix(
                    resolution.reason,
                    f"Grounded in custom_question_answers: {custom_match['label']}.",
                ),
            }
        )

    profile_match = _match_profile_answer(
        label_normalized,
        answer_normalized,
        grounding_catalog.get("profile_answers", []),
    )
    if profile_match is not None:
        return resolution.model_copy(
            update={
                "answer": profile_match["value"],
                "safe_to_autofill": True,
                "answer_source": "profile",
                "reason": _reason_with_suffix(
                    resolution.reason,
                    f"Grounded in profile field: {profile_match['key']}.",
                ),
            }
        )

    generated_match = _match_generated_answer(
        free_answer_normalized,
        grounding_catalog.get("generated_answers", []),
    )
    if generated_match is not None and _is_open_text_prompt(label_normalized):
        return resolution.model_copy(
            update={
                "answer": resolution.answer.strip(),
                "safe_to_autofill": True,
                "answer_source": "generated_material",
                "reason": _reason_with_suffix(
                    resolution.reason,
                    f"Grounded in generated material: {generated_match['key']}.",
                ),
            }
        )
    if generated_match is not None:
        return resolution.model_copy(
            update={
                "answer": None,
                "safe_to_autofill": False,
                "answer_source": "unknown",
                "reason": _reason_with_suffix(
                    resolution.reason,
                    "Rejected generated text because the field label was not an open-text fit or motivation prompt.",
                ),
            }
        )

    return resolution.model_copy(
        update={
            "answer": None,
            "safe_to_autofill": False,
            "answer_source": "unknown",
            "reason": _reason_with_suffix(
                resolution.reason,
                "Rejected because the answer did not match stored profile data, custom answers, or generated materials.",
            ),
        }
    )


def _match_custom_answer(
    label_normalized: str,
    answer_normalized: str,
    custom_answers: list[dict[str, str]],
) -> dict[str, str] | None:
    exact_label_match: dict[str, str] | None = None
    fuzzy_label_match: dict[str, str] | None = None
    for item in custom_answers:
        candidate_label = item["label_normalized"]
        if answer_normalized != item["value_normalized"]:
            continue
        if candidate_label == label_normalized:
            exact_label_match = item
            break
        if len(label_normalized) >= 10 and (
            label_normalized in candidate_label or candidate_label in label_normalized
        ):
            fuzzy_label_match = item
    return exact_label_match or fuzzy_label_match


def _match_profile_answer(
    label_normalized: str,
    answer_normalized: str,
    profile_answers: list[dict[str, Any]],
) -> dict[str, str] | None:
    for item in profile_answers:
        if answer_normalized != item["normalized"]:
            continue
        aliases = item.get("aliases", ())
        if _label_matches_aliases(label_normalized, aliases):
            return item
    return None


def _match_generated_answer(
    free_answer_normalized: str,
    generated_answers: list[dict[str, str]],
) -> dict[str, str] | None:
    if not free_answer_normalized:
        return None
    for item in generated_answers:
        normalized_material = item["normalized"]
        if free_answer_normalized == normalized_material:
            return item
        if len(free_answer_normalized) >= 20 and free_answer_normalized in normalized_material:
            return item
    return None


def _profile_key_aliases(key: str) -> tuple[str, ...]:
    aliases = list(_PROFILE_KEY_LABEL_ALIASES.get(key, ()))
    humanized = _normalize_label(key.replace("_", " "))
    if humanized and humanized not in aliases:
        aliases.append(humanized)
    return tuple(_normalize_label(alias) for alias in aliases if _normalize_label(alias))


def _label_matches_aliases(label_normalized: str, aliases: tuple[str, ...] | list[str]) -> bool:
    if not label_normalized or not aliases:
        return False

    label_tokens = set(label_normalized.split())
    for alias in aliases:
        alias_normalized = _normalize_label(alias)
        if not alias_normalized:
            continue
        if alias_normalized == label_normalized:
            return True
        if alias_normalized in label_normalized or label_normalized in alias_normalized:
            return True

        alias_tokens = set(alias_normalized.split())
        significant_alias_tokens = {token for token in alias_tokens if len(token) >= 4}
        if significant_alias_tokens and significant_alias_tokens.issubset(label_tokens):
            return True
    return False


def _is_open_text_prompt(label_normalized: str) -> bool:
    if not label_normalized:
        return False
    return any(pattern in label_normalized for pattern in _OPEN_TEXT_LABEL_PATTERNS)


def _reason_with_suffix(existing_reason: str, suffix: str) -> str:
    existing = str(existing_reason or "").strip()
    if not existing:
        return suffix
    if suffix in existing:
        return existing
    return f"{existing} {suffix}"
