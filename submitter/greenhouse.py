"""
submitter/greenhouse.py - Greenhouse candidate-side application automation.

This submitter intentionally fails closed:
- it only targets Greenhouse application pages
- it only fills fields it understands
- it refuses to submit when required questions remain unknown
"""
from __future__ import annotations

import json
import logging
import re
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import Page, async_playwright

import config
from llm.form_resolver import resolve_form_questions
from .base import ApplyResult, BaseJobSubmitter

logger = logging.getLogger(__name__)

_SUBMIT_SUCCESS_RE = re.compile(
    r"(thank you|application submitted|your application has been submitted"
    r"|we.ve received your application|successfully submitted"
    r"|you.ve applied|application received|we.ll be in touch)",
    re.IGNORECASE,
)
_SUBMIT_ERROR_RE = re.compile(
    r"(please fix|there (was|were) (an? )?error|field is required|invalid)",
    re.IGNORECASE,
)
_LABEL_CLEAN_RE = re.compile(r"[^a-z0-9\s]")
_CHECKPOINT_DIR_NAME = "manual_checkpoints"
_EMAIL_CODE_HINTS = (
    "confirmation code",
    "verification code",
    "enter code",
    "enter the code",
    "check your email",
    "check your inbox",
    "sent a code",
    "email code",
    "one time code",
    "one-time code",
    "security code",
)
_VERIFICATION_HINTS = (
    "verify your identity",
    "additional verification",
    "authentication code",
    "two factor",
    "2fa",
    "multi factor",
    "verify your email",
    "verify your phone",
)
_KNOWN_PROFILE_FIELD_PATTERNS: dict[str, tuple[str, ...]] = {
    "school_name": ("school", "university", "most recent school you attended"),
    "degree": ("degree", "most recent degree you obtained"),
    "discipline": ("discipline", "field of study", "major"),
    "gpa": ("gpa",),
    "start_date_year": ("start date year",),
    "graduation_year": (
        "expected graduation year",
        "graduation year",
        "anticipated graduation year",
        "expected graduation date",
    ),
    "why_fit": ("tell us a little bit about you and why you think you would be a good fit",),
    "country": ("country where you currently reside",),
    "work_location_countries": ("country or countries you anticipate working in",),
    "work_authorization_us": (
        "authorized to work in the location s you selected",
        "authorized to work in the location you selected",
    ),
    "requires_sponsorship_now_or_future": (
        "require stripe to sponsor you for a work permit",
    ),
    "plans_remote_if_available": ("plan to work remotely",),
    "whatsapp_recruiting_opt_in": ("whatsapp messages from stripe recruiting",),
    "current_or_previous_employer": ("current or previous employer",),
    "current_or_previous_job_title": ("current or previous job title",),
    "country_of_citizenship": ("country region do you have citizenship", "country of citizenship"),
    "current_twitch_employee": ("currently a twitch employee",),
    "current_amazon_employee": ("current employee with amazon",),
    "previous_amazon_employment": ("previously been employed by amazon",),
    "legally_eligible_to_begin_immediately": ("legally eligible to begin employment immediately",),
    "needs_immigration_support_amazon": (
        "immigration related support or sponsorship from amazon",
    ),
    "previous_company_application": ("previously applied to",),
    "open_to_relocation": ("open to relocation",),
    "future_opportunities_opt_in": ("considered for future opportunities",),
    "non_compete_restriction": ("subject to a non competition agreement", "subject to a non-competition agreement"),
    "held_h1b_last_6_years": ("held h 1b status", "held h-1b status"),
    "familiar_with_company": ("familiar with",),
}


class GreenhouseSubmitter(BaseJobSubmitter):
    SOURCE_NAME = "greenhouse"

    async def apply_to_job(
        self,
        job: dict,
        profile: dict,
        dry_run: bool = False,
    ) -> ApplyResult:
        apply_url = build_greenhouse_apply_url(job)
        if not apply_url:
            return ApplyResult(
                source=self.SOURCE_NAME,
                apply_url="",
                success=False,
                submitted=False,
                dry_run=dry_run,
                error="Could not derive Greenhouse apply URL from job record.",
            )

        defaults = _build_form_defaults(job, profile)
        resume_path = Path(defaults["resume_path"])
        if not resume_path.exists():
            return ApplyResult(
                source=self.SOURCE_NAME,
                apply_url=apply_url,
                success=False,
                submitted=False,
                dry_run=dry_run,
                error=f"Resume file not found: {resume_path}",
            )

        filled_fields: list[str] = []
        skipped_optional_fields: list[str] = []
        temp_cover_letter_path: Path | None = None
        resolver_payload: dict[str, object] | None = None

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=config.PLAYWRIGHT_HEADLESS)
            context = await browser.new_context(**_context_kwargs_for_job(job))
            page = await context.new_page()
            try:
                logger.info("[Apply/Greenhouse] Opening %s", apply_url)
                await page.goto(apply_url, wait_until="networkidle")

                required_labels = await _get_required_prompt_texts(page)
                handled_required_patterns: set[str] = set()

                await _fill_text_field(page, "First Name", defaults["first_name"])
                filled_fields.append("First Name")
                handled_required_patterns.add(_normalize_label("First Name"))

                await _fill_text_field(page, "Last Name", defaults["last_name"])
                filled_fields.append("Last Name")
                handled_required_patterns.add(_normalize_label("Last Name"))

                # Optional name/pronoun fields — only fill if the form actually has them
                for opt_label, opt_key in [
                    ("Preferred First Name", "preferred_name"),
                    ("Preferred Name",       "preferred_name"),
                    ("Pronouns",             "pronouns"),
                ]:
                    val = defaults.get(opt_key)
                    if val and await _label_exists(page, opt_label):
                        await _fill_text_field(page, opt_label, val)
                        filled_fields.append(opt_label)

                await _fill_text_field(page, "Email", defaults["email"])
                filled_fields.append("Email")
                handled_required_patterns.add(_normalize_label("Email"))

                await _select_option(page, "Country", defaults["phone_country"])
                filled_fields.append("Country")
                handled_required_patterns.add(_normalize_label("Country"))

                await _fill_text_field(page, "Phone", defaults["phone"])
                filled_fields.append("Phone")
                handled_required_patterns.add(_normalize_label("Phone"))

                await _select_option(page, "Location (City)", defaults["location_city"])
                filled_fields.append("Location (City)")
                handled_required_patterns.add(_normalize_label("Location (City)"))

                await page.set_input_files("#resume", str(resume_path))
                filled_fields.append("Resume/CV")

                cover_letter_text = _build_cover_letter_text(job, defaults)
                if cover_letter_text:
                    temp_cover_letter_path = _write_temp_text_file(
                        cover_letter_text,
                        prefix="cover_letter_",
                    )
                    await page.set_input_files("#cover_letter", str(temp_cover_letter_path))
                    filled_fields.append("Cover Letter")
                else:
                    skipped_optional_fields.append("Cover Letter")

                chosen_location_preferences: list[str] = []
                for label_text, index in [
                    ("What is your first location preference?", 0),
                    ("Second location preference", 1),
                    ("Third location preference", 2),
                ]:
                    if not await _label_exists(page, label_text):
                        continue
                    selected_option = await _select_preferred_option(
                        page,
                        label_text,
                        _location_preference_candidates(defaults, index),
                        exclude=chosen_location_preferences,
                    )
                    if not selected_option:
                        continue
                    chosen_location_preferences.append(selected_option)
                    filled_fields.append(label_text)
                    handled_required_patterns.add(_normalize_label(label_text))

                rules = [
                    # Education
                    _Rule("We are always aiming to keep our school list inclusive", defaults.get("school_name"), "text"),
                    _Rule("School", defaults.get("school_name"), "text"),
                    _Rule("University", defaults.get("school_name"), "text"),
                    _Rule("Institution", defaults.get("school_name"), "text"),
                    _Rule("Degree", defaults.get("degree"), "text"),
                    _Rule("Major", defaults.get("discipline"), "text"),
                    _Rule("Discipline", defaults.get("discipline"), "text"),
                    _Rule("Field of Study", defaults.get("discipline"), "text"),
                    _Rule("As part of our commitment to understanding candidates' backgrounds", defaults.get("sat_act_score"), "text"),
                    _Rule("Similarly, we also invite you to provide your GPA", defaults.get("gpa"), "text"),
                    # Graduation / availability
                    _Rule("Start Date Year", defaults.get("start_date_year"), "text"),
                    _Rule("Expected Graduation Year", defaults.get("graduation_year"), "text"),
                    _Rule("Graduation Year", defaults.get("graduation_year"), "text"),
                    _Rule("Anticipated Graduation Year", defaults.get("graduation_year"), "text"),
                    _Rule("Expected Graduation Date", defaults.get("graduation_year"), "text"),
                    # Links & fit
                    _Rule("LinkedIn Profile, Github, Personal Website, or Portfolio", defaults.get("links"), "text"),
                    _Rule("Have you ever been employed by Stripe or a Stripe affiliate?", defaults.get("stripe_employment_history", "No"), "select"),
                    _Rule("Tell us a little bit about you and why you think you would be a good fit", defaults.get("why_fit"), "text"),
                    _Rule("As Stripe grows, we are always aiming to expand our recruitment presence", defaults.get("conference_history"), "text"),
                    # Work authorization
                    _Rule("Are you currently eligible to work in the United States?", defaults.get("work_authorization_us") or "Yes", "select"),
                    _Rule("Do you require visa sponsorship, now or in the future, to continue working in the United States?", defaults.get("requires_sponsorship_now_or_future") or "No", "select"),
                    _Rule("Please select the country where you currently reside.", defaults.get("country") or defaults.get("country_of_citizenship"), "select"),
                    _Rule(
                        "Please select the country or countries you anticipate working in for the role in which you are applying.",
                        defaults.get("work_location_countries"),
                        "checkbox",
                    ),
                    _Rule(
                        "Are you authorized to work in the location(s) you selected in your previous response?",
                        defaults.get("work_authorization_us") or "Yes",
                        "select",
                    ),
                    _Rule(
                        "Will you require Stripe to sponsor you for a work permit now or in the future for the location(s) you selected in in your previous response?",
                        defaults.get("requires_sponsorship_now_or_future") or "No",
                        "select",
                    ),
                    _Rule(
                        "If this role offers the option to work from a remote location, do you plan to work remotely?",
                        defaults.get("plans_remote_if_available"),
                        "select",
                    ),
                    # Employment history
                    _Rule("Who is your current or previous employer?", defaults.get("current_or_previous_employer"), "text"),
                    _Rule("What is your current or previous job title?", defaults.get("current_or_previous_job_title"), "text"),
                    _Rule("What is the most recent school you attended?", defaults.get("school_name"), "text"),
                    _Rule("What is the most recent degree you obtained?", defaults.get("degree"), "text"),
                    _Rule("Do you opt-in to receive WhatsApp messages from Stripe Recruiting?", defaults.get("whatsapp_recruiting_opt_in"), "select"),
                    _Rule("If located in the US, in what city and state do you reside?", defaults.get("city_state"), "text"),
                    # Amazon / Twitch custom questions
                    _Rule("Are you currently a Twitch employee?", defaults.get("current_twitch_employee"), "select"),
                    _Rule("Are you a current employee with Amazon or any Amazon subsidiary", defaults.get("current_amazon_employee"), "select"),
                    _Rule("Have you previously applied to Amazon or any Amazon subsidiary", defaults.get("previous_company_application"), "select"),
                    _Rule("Have you previously been employed by Amazon or any Amazon subsidiary", defaults.get("previous_amazon_employment"), "select"),
                    _Rule("Are you open to relocation?", defaults.get("open_to_relocation"), "select"),
                    _Rule("Would you like to be considered for future opportunities", defaults.get("future_opportunities_opt_in"), "select"),
                    _Rule("Are you subject to a non-competition agreement", defaults.get("non_compete_restriction"), "select"),
                    _Rule("Have you held H-1B status", defaults.get("held_h1b_last_6_years"), "select"),
                    _Rule("Are you familiar with", defaults.get("familiar_with_company"), "select"),
                    _Rule("If offered employment by Amazon, would you be legally eligible to begin employment immediately?", defaults.get("legally_eligible_to_begin_immediately"), "select"),
                    _Rule("immigration related support or sponsorship from Amazon", defaults.get("needs_immigration_support_amazon"), "select"),
                    _Rule("In which country/region do you have citizenship?", defaults.get("country_of_citizenship"), "select"),
                    # EEO / self-ID
                    _Rule("Self-identification is voluntary. Please acknowledge this in the drop down below.", defaults.get("self_identification_acknowledgement"), "select"),
                    _Rule("Gender", defaults.get("gender_text"), "select"),
                    _Rule("Are you Hispanic/Latino?", defaults.get("hispanic_ethnicity"), "select"),
                    _Rule("Veteran Status", defaults.get("veteran_status"), "select"),
                    _Rule("Disability Status", defaults.get("disability_status"), "select"),
                ]
                rules.extend(_custom_rules_from_defaults(defaults))

                for rule in rules:
                    if not rule.value:
                        continue
                    if rule.kind == "checkbox":
                        if not await _fieldset_exists(page, rule.label):
                            continue
                        await _set_group_options(page, rule.label, rule.value)
                    elif rule.kind == "select":
                        if not await _label_exists(page, rule.label):
                            continue
                        await _select_option(page, rule.label, str(rule.value))
                    else:
                        if not await _label_exists(page, rule.label):
                            continue
                        await _fill_text_field(page, rule.label, str(rule.value))
                    filled_fields.append(rule.label)
                    handled_required_patterns.add(_normalize_label(rule.label))

                unknown_required_fields = sorted(
                    label
                    for label in required_labels
                    if not any(pattern in label for pattern in handled_required_patterns)
                )
                resolver_candidates = [
                    label
                    for label in unknown_required_fields
                    if not (
                        (field_key := _matching_profile_field_key(label))
                        and not defaults.get(field_key)
                    )
                ]
                if resolver_candidates:
                    resolver_result, resolver_payload = await resolve_form_questions(
                        resolver_candidates,
                        defaults,
                        job,
                        profile,
                    )
                    if resolver_result is not None:
                        for resolution in resolver_result.resolutions:
                            if not resolution.safe_to_autofill or not resolution.answer:
                                continue
                            if not await _label_exists(page, resolution.label):
                                continue
                            field_kind = await _field_kind(page, resolution.label)
                            if field_kind == "select":
                                await _select_option(page, resolution.label, resolution.answer)
                            elif field_kind == "text":
                                await _fill_text_field(page, resolution.label, resolution.answer)
                            else:
                                continue
                            filled_fields.append(resolution.label)
                            handled_required_patterns.add(_normalize_label(resolution.label))

                        unknown_required_fields = sorted(
                            label
                            for label in required_labels
                            if not any(pattern in label for pattern in handled_required_patterns)
                        )
                if unknown_required_fields:
                    missing_profile_fields = _missing_profile_fields_for(
                        unknown_required_fields,
                        defaults,
                    )
                    blocked_reason = (
                        "missing_profile_fields"
                        if missing_profile_fields
                        else "unknown_required_fields"
                    )
                    error = (
                        "Missing required profile fields: "
                        + ", ".join(missing_profile_fields)
                        if missing_profile_fields
                        else "Unknown required application fields remain."
                    )
                    return ApplyResult(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url,
                        success=False,
                        submitted=False,
                        dry_run=dry_run,
                        retryable=False,
                        error=error,
                        blocked_reason=blocked_reason,
                        filled_fields=filled_fields,
                        skipped_optional_fields=skipped_optional_fields,
                        unknown_required_fields=unknown_required_fields,
                        missing_profile_fields=missing_profile_fields,
                        resolver_data=resolver_payload,
                    )

                if dry_run:
                    return ApplyResult(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url,
                        success=True,
                        submitted=False,
                        dry_run=True,
                        filled_fields=filled_fields,
                        skipped_optional_fields=skipped_optional_fields,
                        resolver_data=resolver_payload,
                    )

                submit_button = page.get_by_role("button", name=re.compile(r"submit application", re.I))
                try:
                    await submit_button.click()
                    confirmation_text = await _wait_for_submission_confirmation(page)
                except (PlaywrightTimeoutError, TimeoutError, ValueError) as exc:
                    manual_checkpoint = await _detect_manual_checkpoint(
                        page,
                        context,
                        job,
                        apply_url,
                        failure_reason=str(exc),
                    )
                    if manual_checkpoint is not None:
                        return _manual_apply_result(
                            source=self.SOURCE_NAME,
                            apply_url=apply_url,
                            dry_run=dry_run,
                            filled_fields=filled_fields,
                            skipped_optional_fields=skipped_optional_fields,
                            resolver_payload=resolver_payload,
                            checkpoint=manual_checkpoint,
                        )
                    raise exc
                return ApplyResult(
                    source=self.SOURCE_NAME,
                    apply_url=apply_url,
                    success=True,
                    submitted=True,
                    dry_run=False,
                    filled_fields=filled_fields,
                    skipped_optional_fields=skipped_optional_fields,
                    resolver_data=resolver_payload,
                    confirmation_text=confirmation_text,
                )
            except Exception as exc:
                manual_checkpoint = await _detect_manual_checkpoint(
                    page,
                    context,
                    job,
                    apply_url,
                    failure_reason=str(exc),
                )
                if manual_checkpoint is not None:
                    return _manual_apply_result(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url,
                        dry_run=dry_run,
                        filled_fields=filled_fields,
                        skipped_optional_fields=skipped_optional_fields,
                        resolver_payload=resolver_payload,
                        checkpoint=manual_checkpoint,
                    )
                return ApplyResult(
                    source=self.SOURCE_NAME,
                    apply_url=apply_url,
                    success=False,
                    submitted=False,
                    dry_run=dry_run,
                    error=str(exc),
                    filled_fields=filled_fields,
                    skipped_optional_fields=skipped_optional_fields,
                    resolver_data=resolver_payload,
                )
            finally:
                if temp_cover_letter_path is not None and temp_cover_letter_path.exists():
                    temp_cover_letter_path.unlink(missing_ok=True)
                await context.close()
                await browser.close()

    async def resume_manual_checkpoint(self, job: dict) -> ApplyResult:
        apply_url = build_greenhouse_apply_url(job)
        payload = _load_json(job.get("apply_data"))
        checkpoint_url = str(payload.get("checkpoint_url") or payload.get("apply_url") or apply_url or "").strip()
        if not checkpoint_url:
            return ApplyResult(
                source=self.SOURCE_NAME,
                apply_url=apply_url or "",
                success=False,
                submitted=False,
                dry_run=False,
                retryable=False,
                error="No saved manual checkpoint URL is available for this application.",
                blocked_reason="verification_required",
            )

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=False)
            context = await browser.new_context(**_context_kwargs_for_job(job))
            page = await context.new_page()
            try:
                logger.info("[Apply/Greenhouse] Resuming manual checkpoint at %s", checkpoint_url)
                await page.goto(checkpoint_url, wait_until="networkidle")

                confirmation_text = await _wait_for_manual_completion(page)
                if confirmation_text:
                    return ApplyResult(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url or checkpoint_url,
                        success=True,
                        submitted=True,
                        dry_run=False,
                        confirmation_text=confirmation_text,
                        checkpoint_url=page.url,
                    )

                manual_checkpoint = await _detect_manual_checkpoint(
                    page,
                    context,
                    job,
                    apply_url or checkpoint_url,
                    failure_reason="Manual resume session ended without a confirmation signal.",
                )
                if manual_checkpoint is not None:
                    return _manual_apply_result(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url or checkpoint_url,
                        dry_run=False,
                        filled_fields=[],
                        skipped_optional_fields=[],
                        resolver_payload=None,
                        checkpoint=manual_checkpoint,
                    )

                return ApplyResult(
                    source=self.SOURCE_NAME,
                    apply_url=apply_url or checkpoint_url,
                    success=False,
                    submitted=False,
                    dry_run=False,
                    retryable=True,
                    error="Manual resume session ended without reaching a confirmation state.",
                    checkpoint_url=page.url,
                )
            finally:
                await _persist_checkpoint_state(context, job)
                await context.close()
                await browser.close()


class _Rule:
    def __init__(self, label: str, value: object | None, kind: str) -> None:
        self.label = label
        self.value = value
        self.kind = kind


def build_greenhouse_apply_url(job: dict) -> str | None:
    token = _extract_greenhouse_token(job.get("url") or "")
    company = (job.get("company") or "").strip()
    if not token or not company:
        return None
    return f"https://job-boards.greenhouse.io/embed/job_app?for={company}&token={token}"


def _extract_greenhouse_token(url: str) -> str | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    if "token" in query and query["token"]:
        return query["token"][0]
    if "gh_jid" in query and query["gh_jid"]:
        return query["gh_jid"][0]

    match = re.search(r"/jobs/(\d+)", parsed.path)
    if match:
        return match.group(1)
    return None


def _build_form_defaults(job: dict, profile: dict) -> dict:
    prefs = profile.get("preferences_json", {})
    defaults = dict(prefs.get("application_form_defaults") or {})
    first_name, last_name = _split_name(profile.get("name") or "")
    _set_if_blank(defaults, "first_name", first_name)
    _set_if_blank(defaults, "last_name", last_name)
    _set_if_blank(defaults, "preferred_name", first_name)
    _set_if_blank(defaults, "email", profile.get("email") or "")
    _set_if_blank(defaults, "phone", profile.get("phone") or "")
    _set_if_blank(defaults, "resume_path", prefs.get("resume_source_path") or str(config.ACTIVE_RESUME_PATH))
    _set_if_blank(defaults, "phone_country", "United States")
    _set_if_blank(defaults, "location_city", "Kent, Washington, United States")
    if str(defaults.get("location_city") or "").strip().lower() == "kent, wa":
        defaults["location_city"] = "Kent, Washington, United States"
    _set_if_blank(defaults, "city_state", "Kent, WA")
    _set_if_blank(defaults, "work_location_countries", _work_location_countries(defaults, prefs))
    _set_if_blank(
        defaults,
        "work_authorization_us_text",
        "Yes, I am currently eligible to work in the country where this role is based.",
    )
    _set_if_blank(
        defaults,
        "requires_sponsorship_text",
        "No, I do not require visa sponsorship now or in the future to continue working in the country where this role is based.",
    )
    _set_if_blank(defaults, "gender_text", _title_case_gender(defaults.get("gender")))
    _set_if_blank(defaults, "stripe_employment_history", "No")
    _set_if_blank(defaults, "plans_remote_if_available", _remote_work_preference(prefs))
    _set_if_blank(defaults, "whatsapp_recruiting_opt_in", "No")
    _set_if_blank(
        defaults,
        "country_of_citizenship",
        defaults.get("country") or prefs.get("citizenship") or "United States",
    )
    _set_if_blank(defaults, "current_twitch_employee", "No")
    _set_if_blank(defaults, "current_amazon_employee", "No")
    _set_if_blank(defaults, "previous_company_application", "")
    _set_if_blank(defaults, "previous_amazon_employment", "Yes")
    _set_if_blank(defaults, "open_to_relocation", "")
    _set_if_blank(defaults, "future_opportunities_opt_in", "")
    _set_if_blank(defaults, "non_compete_restriction", "")
    _set_if_blank(defaults, "held_h1b_last_6_years", "")
    _set_if_blank(defaults, "familiar_with_company", "")
    _set_if_blank(defaults, "legally_eligible_to_begin_immediately", "Yes")
    _set_if_blank(defaults, "needs_immigration_support_amazon", "No")
    _set_if_blank(defaults, "why_fit", _build_why_fit_text(job, profile))
    return defaults


def _split_name(name: str) -> tuple[str, str]:
    parts = [part for part in name.split() if part.strip()]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _title_case_gender(value: object) -> str | None:
    if not value:
        return None
    raw = str(value).strip().lower()
    mapping = {
        "male": "Male",
        "female": "Female",
        "man": "Man",
        "woman": "Woman",
    }
    return mapping.get(raw, str(value).strip())


def _build_why_fit_text(job: dict, profile: dict) -> str:
    prefs = profile.get("preferences_json", {})
    tailor_payload = _load_json(job.get("tailor_data"))
    answers = _load_json(tailor_payload.get("answers"))
    answers_result = answers.get("result") if isinstance(answers.get("result"), dict) else answers
    scorer_payload = _load_json(job.get("scorer_data"))
    scorer_result = scorer_payload.get("result") if isinstance(scorer_payload.get("result"), dict) else scorer_payload

    parts: list[str] = []
    why_role = answers_result.get("why_role")
    why_hire = answers_result.get("why_hire")
    if isinstance(why_role, str) and why_role.strip():
        parts.append(why_role.strip())
    if isinstance(why_hire, str) and why_hire.strip():
        parts.append(why_hire.strip())
    if parts:
        return "\n\n".join(parts)

    summary = job.get("tailored_summary")
    if isinstance(summary, str) and summary.strip():
        parts.append(summary.strip())

    one_line = scorer_result.get("one_line_summary")
    if isinstance(one_line, str) and one_line.strip():
        parts.append(one_line.strip())

    if parts:
        return "\n\n".join(parts)

    profile_summary = prefs.get("candidate_profile_summary")
    company_motivation = _company_motivation_for(
        job.get("company"),
        prefs.get("company_motivation_overrides"),
    )
    title = job.get("title") or "this role"
    company = job.get("company") or "your team"

    parts = []
    if isinstance(profile_summary, str) and profile_summary.strip():
        parts.append(profile_summary.strip())
    if company_motivation:
        parts.append(company_motivation)
    if parts:
        parts.append(
            f"I am interested in {title} at {company} because the role aligns with my "
            f"background in backend development, testing, CI/CD, and building reliable "
            f"cloud-deployed software in collaborative engineering environments."
        )
        return "\n\n".join(parts)

    return (
        f"I am a software developer based in Kent, Washington with hands-on experience "
        f"from production internships, backend development, testing, and cloud delivery. "
        f"I am interested in {title} at {company} because the role aligns with my "
        f"background in Python, Java, integration work, and building reliable software in "
        f"collaborative engineering environments."
    )


def _build_cover_letter_text(job: dict, defaults: dict) -> str:
    cover_letter = job.get("cover_letter")
    if isinstance(cover_letter, str) and cover_letter.strip():
        return cover_letter.strip()
    why_fit = defaults.get("why_fit")
    return str(why_fit).strip() if why_fit else ""


def _location_preference(defaults: dict, index: int) -> str | None:
    values = defaults.get("location_preferences")
    if not isinstance(values, list):
        return None
    if index >= len(values):
        return None
    value = values[index]
    return str(value).strip() if value else None


def _location_preference_candidates(defaults: dict, index: int) -> list[str]:
    raw_values = defaults.get("location_preferences")
    if not isinstance(raw_values, list):
        raw_values = []

    normalized = [
        str(value).strip()
        for value in raw_values
        if str(value).strip()
    ]
    ordered = normalized[index:] + normalized[:index]
    fallbacks = [
        "Seattle, WA, United States",
        "San Francisco, CA, United States",
        "I am open to working in any office",
    ]

    seen: set[str] = set()
    candidates: list[str] = []
    for value in ordered + fallbacks:
        key = _normalize_label(value)
        if not key or key in seen:
            continue
        seen.add(key)
        candidates.append(value)
    return candidates


def _work_location_countries(defaults: dict, prefs: dict) -> list[str] | None:
    explicit = defaults.get("work_location_countries")
    if isinstance(explicit, list) and explicit:
        return [str(item).strip() for item in explicit if str(item).strip()]

    country = str(
        defaults.get("country")
        or defaults.get("country_of_citizenship")
        or prefs.get("citizenship")
        or ""
    ).strip().lower()
    mapping = {
        "united states": ["US"],
        "u.s. citizen": ["US"],
        "us": ["US"],
    }
    return mapping.get(country)


def _remote_work_preference(prefs: dict) -> str:
    preferred_locations = [
        str(item).strip().lower()
        for item in (prefs.get("preferred_locations") or [])
        if str(item).strip()
    ]
    return "Yes" if "remote" in preferred_locations else "No"


def _set_if_blank(defaults: dict, key: str, value: object) -> None:
    if defaults.get(key):
        return
    if value is None:
        return
    defaults[key] = value


def _custom_rules_from_defaults(defaults: dict) -> list[_Rule]:
    raw_rules = defaults.get("custom_question_answers")
    if not isinstance(raw_rules, list):
        return []

    rules: list[_Rule] = []
    for item in raw_rules:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = item.get("value")
        kind = str(item.get("kind") or "text").strip().lower()
        if not label or value in {None, ""}:
            continue
        if kind not in {"text", "select"}:
            continue
        rules.append(_Rule(label, str(value), kind))
    return rules


def _company_motivation_for(company: object, overrides: object) -> str | None:
    if not company or not isinstance(overrides, dict):
        return None

    company_name = str(company).strip().lower()
    for key, value in overrides.items():
        if not key or not value:
            continue
        key_name = str(key).strip().lower()
        if key_name and key_name in company_name:
            return str(value).strip()
    return None


def _load_json(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _context_kwargs_for_job(job: dict) -> dict[str, str]:
    state_path = _checkpoint_state_path(job)
    if state_path is not None and state_path.exists():
        return {"storage_state": str(state_path)}
    return {}


def _checkpoint_root() -> Path:
    return Path(config.DB_PATH).resolve().parent / _CHECKPOINT_DIR_NAME


def _checkpoint_dir(job: dict) -> Path:
    app_id = job.get("app_id") or "unknown"
    job_id = job.get("job_id") or job.get("id") or "unknown"
    return _checkpoint_root() / f"app_{app_id}_job_{job_id}"


def _checkpoint_state_path(job: dict) -> Path | None:
    payload = _load_json(job.get("apply_data"))
    artifacts = payload.get("checkpoint_artifacts")
    if isinstance(artifacts, dict):
        raw_path = str(artifacts.get("storage_state_path") or "").strip()
        if raw_path:
            candidate = Path(raw_path)
            if candidate.exists():
                return candidate

    fallback = _checkpoint_dir(job) / "storage_state.json"
    if fallback.exists():
        return fallback
    return None


async def _persist_checkpoint_state(context, job: dict) -> str | None:
    directory = _checkpoint_dir(job)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "storage_state.json"
    try:
        await context.storage_state(path=str(path))
    except Exception:
        return None
    return str(path.resolve())


async def _detect_manual_checkpoint(
    page: Page,
    context,
    job: dict,
    apply_url: str,
    failure_reason: str,
) -> dict[str, object] | None:
    if page.is_closed():
        return None

    captcha_error = await _captcha_block_error(page)
    if captcha_error:
        return await _capture_manual_checkpoint(
            page,
            context,
            job,
            apply_url,
            blocked_reason="captcha_required",
            manual_action_type="captcha",
            error=captcha_error,
            next_step=(
                "Open a manual resume session from the dashboard, complete the CAPTCHA, "
                "and then clear the block to retry auto-apply."
            ),
            failure_reason=failure_reason,
        )

    verification_details = await _verification_checkpoint(page, failure_reason)
    if verification_details is None:
        return None

    return await _capture_manual_checkpoint(
        page,
        context,
        job,
        apply_url,
        blocked_reason=str(verification_details["blocked_reason"]),
        manual_action_type=str(verification_details["manual_action_type"]),
        error=str(verification_details["error"]),
        next_step=str(verification_details["next_step"]),
        failure_reason=failure_reason,
    )


async def _verification_checkpoint(page: Page, failure_reason: str) -> dict[str, str] | None:
    try:
        body_text = await page.locator("body").inner_text()
    except Exception:
        body_text = ""

    combined = _normalize_label(
        " ".join(
            part
            for part in (
                body_text,
                failure_reason,
                page.url,
            )
            if str(part).strip()
        )
    )
    if not combined:
        return None

    if any(_normalize_label(marker) in combined for marker in _EMAIL_CODE_HINTS):
        return {
            "blocked_reason": "email_code_required",
            "manual_action_type": "email_code",
            "error": "The application requires a confirmation or verification code to continue.",
            "next_step": (
                "Open a manual resume session from the dashboard, retrieve the emailed code, "
                "complete the verification prompt, and then clear the block to retry if needed."
            ),
        }

    if any(_normalize_label(marker) in combined for marker in _VERIFICATION_HINTS):
        return {
            "blocked_reason": "verification_required",
            "manual_action_type": "verification",
            "error": "The application requires a manual verification step before it can be submitted.",
            "next_step": (
                "Open a manual resume session from the dashboard, complete the verification step, "
                "and then clear the block to retry if needed."
            ),
        }

    return None


async def _capture_manual_checkpoint(
    page: Page,
    context,
    job: dict,
    apply_url: str,
    *,
    blocked_reason: str,
    manual_action_type: str,
    error: str,
    next_step: str,
    failure_reason: str,
) -> dict[str, object]:
    directory = _checkpoint_dir(job)
    directory.mkdir(parents=True, exist_ok=True)
    checkpoint_url = page.url or apply_url
    artifacts: dict[str, str] = {}

    screenshot_path = directory / "checkpoint.png"
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
        artifacts["screenshot_path"] = str(screenshot_path.resolve())
    except Exception:
        pass

    html_path = directory / "checkpoint.html"
    try:
        html_path.write_text(await page.content(), encoding="utf-8")
        artifacts["html_path"] = str(html_path.resolve())
    except Exception:
        pass

    text_path = directory / "checkpoint.txt"
    body_text = ""
    try:
        body_text = await page.locator("body").inner_text()
        text_path.write_text(body_text, encoding="utf-8")
        artifacts["text_path"] = str(text_path.resolve())
    except Exception:
        pass

    state_path = await _persist_checkpoint_state(context, job)
    if state_path:
        artifacts["storage_state_path"] = state_path

    metadata = {
        "blocked_reason": blocked_reason,
        "manual_action_type": manual_action_type,
        "error": error,
        "next_step": next_step,
        "failure_reason": failure_reason,
        "checkpoint_url": checkpoint_url,
        "apply_url": apply_url,
        "page_text_excerpt": body_text[:1000],
    }
    metadata_path = directory / "checkpoint.json"
    try:
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        artifacts["metadata_path"] = str(metadata_path.resolve())
    except Exception:
        pass

    return {
        "blocked_reason": blocked_reason,
        "manual_action_type": manual_action_type,
        "error": error,
        "next_step": next_step,
        "checkpoint_url": checkpoint_url,
        "checkpoint_artifacts": artifacts,
    }


def _manual_apply_result(
    *,
    source: str,
    apply_url: str,
    dry_run: bool,
    filled_fields: list[str],
    skipped_optional_fields: list[str],
    resolver_payload: dict[str, object] | None,
    checkpoint: dict[str, object],
) -> ApplyResult:
    return ApplyResult(
        source=source,
        apply_url=apply_url,
        success=False,
        submitted=False,
        dry_run=dry_run,
        retryable=False,
        error=str(checkpoint.get("error") or "manual_action_required"),
        blocked_reason=str(checkpoint.get("blocked_reason") or "verification_required"),
        manual_action_required=True,
        manual_action_type=str(checkpoint.get("manual_action_type") or ""),
        next_step=str(checkpoint.get("next_step") or ""),
        checkpoint_url=str(checkpoint.get("checkpoint_url") or apply_url),
        checkpoint_artifacts=(
            checkpoint.get("checkpoint_artifacts")
            if isinstance(checkpoint.get("checkpoint_artifacts"), dict)
            else None
        ),
        filled_fields=filled_fields,
        skipped_optional_fields=skipped_optional_fields,
        resolver_data=resolver_payload,
    )


async def _get_required_prompt_texts(page: Page) -> set[str]:
    required: set[str] = set()
    for selector in ("label", "legend"):
        prompts = page.locator(selector)
        count = await prompts.count()
        for index in range(count):
            text = (await prompts.nth(index).inner_text()).strip()
            if "*" not in text:
                continue
            required.add(_normalize_label(text))
    return required


def _normalize_label(text: str) -> str:
    cleaned = _LABEL_CLEAN_RE.sub(" ", text.replace("*", "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()


async def _label_exists(page: Page, label_text: str) -> bool:
    return await _find_matching_label(page, label_text) is not None


async def _fieldset_exists(page: Page, legend_text: str) -> bool:
    return await _find_matching_legend(page, legend_text) is not None


async def _fill_text_field(page: Page, label_text: str, value: str) -> None:
    if not value:
        return
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(_id_selector(field_id))
    await locator.scroll_into_view_if_needed()
    await locator.click()
    await locator.fill(value)


async def _select_option(page: Page, label_text: str, search_text: str) -> None:
    if not search_text:
        return
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(_id_selector(field_id))
    await locator.scroll_into_view_if_needed()
    await locator.click()
    if await _click_visible_option(page, field_id, search_text):
        return

    await locator.fill(search_text)
    await page.wait_for_timeout(800)
    if await _click_visible_option(page, field_id, search_text):
        return

    try:
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
    except PlaywrightTimeoutError:
        raise ValueError(f"Option not found for {label_text!r}: {search_text!r}")


async def _set_group_options(page: Page, legend_text: str, value: object) -> None:
    values = _as_choice_list(value)
    if not values:
        return

    fieldset = await _get_fieldset_locator(page, legend_text)
    input_type = await fieldset.locator("input").first.get_attribute("type")
    for option_text in values:
        option = await _find_matching_option_label(fieldset, option_text)
        if option is None:
            raise ValueError(f"Option label not found for {legend_text!r}: {option_text!r}")
        field_id = await option.get_attribute("for")
        if not field_id:
            raise ValueError(f"Option label missing target for {legend_text!r}: {option_text!r}")
        locator = fieldset.locator(_id_selector(field_id)).first
        await locator.scroll_into_view_if_needed()
        if not await locator.is_checked():
            await locator.check()
        if input_type == "radio":
            break


async def _select_preferred_option(
    page: Page,
    label_text: str,
    candidates: list[str],
    exclude: list[str] | None = None,
) -> str | None:
    exclude_keys = {_normalize_label(value) for value in (exclude or []) if value}
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(_id_selector(field_id))
    await locator.scroll_into_view_if_needed()
    await locator.click()
    await page.wait_for_timeout(300)

    option_texts = await _visible_option_texts(page, field_id)
    option_map = { _normalize_label(text): text for text in option_texts }

    for candidate in candidates:
        candidate_key = _normalize_label(candidate)
        if not candidate_key or candidate_key in exclude_keys:
            continue
        for option_key, option_text in option_map.items():
            if option_key in exclude_keys:
                continue
            if option_key == candidate_key or candidate_key in option_key:
                await _click_visible_option(page, field_id, option_text)
                return option_text

    return None


async def _get_field_id(page: Page, label_text: str) -> str:
    label = await _find_matching_label(page, label_text)
    if label is None:
        raise ValueError(f"Field label not found: {label_text}")
    field_id = await label.get_attribute("for")
    if not field_id:
        raise ValueError(f"Field label does not reference an input: {label_text}")
    return field_id


async def _field_kind(page: Page, label_text: str) -> str:
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(_id_selector(field_id)).first
    metadata = await locator.evaluate(
        """element => ({
            tagName: (element.tagName || '').toLowerCase(),
            type: (element.getAttribute('type') || '').toLowerCase(),
            role: (element.getAttribute('role') || '').toLowerCase(),
            ariaHaspopup: (element.getAttribute('aria-haspopup') || '').toLowerCase(),
            ariaAutocomplete: (element.getAttribute('aria-autocomplete') || '').toLowerCase()
        })"""
    )
    if metadata["tagName"] == "select":
        return "select"
    if metadata["type"] == "checkbox":
        return "checkbox"
    if metadata["type"] == "radio":
        return "radio"
    if metadata["role"] == "combobox":
        return "select"
    if metadata["ariaHaspopup"] == "listbox":
        return "select"
    if metadata["ariaAutocomplete"] in {"list", "both"}:
        return "select"
    return "text"


async def _find_matching_label(page: Page, label_text: str):
    labels = page.locator("label")
    count = await labels.count()
    query = _normalize_label(label_text)

    exact_matches = []
    fuzzy_matches = []
    for index in range(count):
        candidate = labels.nth(index)
        text = _normalize_label((await candidate.inner_text()).strip())
        if not text:
            continue
        if text == query:
            exact_matches.append(candidate)
            continue
        if len(query) >= 10 and query in text:
            fuzzy_matches.append(candidate)

    if exact_matches:
        return exact_matches[0]
    if fuzzy_matches:
        return fuzzy_matches[0]
    return None


async def _find_matching_legend(page: Page, legend_text: str):
    legends = page.locator("legend")
    count = await legends.count()
    query = _normalize_label(legend_text)

    exact_matches = []
    fuzzy_matches = []
    for index in range(count):
        candidate = legends.nth(index)
        text = _normalize_label((await candidate.inner_text()).strip())
        if not text:
            continue
        if text == query:
            exact_matches.append(candidate)
            continue
        if len(query) >= 10 and query in text:
            fuzzy_matches.append(candidate)

    if exact_matches:
        return exact_matches[0]
    if fuzzy_matches:
        return fuzzy_matches[0]
    return None


async def _get_fieldset_locator(page: Page, legend_text: str):
    legend = await _find_matching_legend(page, legend_text)
    if legend is None:
        raise ValueError(f"Fieldset legend not found: {legend_text}")
    return legend.locator("xpath=ancestor::fieldset[1]")


def _id_selector(field_id: str) -> str:
    return f"[id={json.dumps(field_id)}]"


def _as_choice_list(value: object) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    return [text] if text else []


async def _find_matching_option_label(fieldset, option_text: str):
    labels = fieldset.locator("label")
    count = await labels.count()
    query = _normalize_label(option_text)

    exact_matches = []
    fuzzy_matches = []
    for index in range(count):
        candidate = labels.nth(index)
        text = _normalize_label((await candidate.inner_text()).strip())
        if not text:
            continue
        if text == query:
            exact_matches.append(candidate)
            continue
        if len(query) >= 2 and (query in text or text in query):
            fuzzy_matches.append(candidate)

    if exact_matches:
        return exact_matches[0]
    if fuzzy_matches:
        return fuzzy_matches[0]
    return None


async def _visible_option_texts(page: Page, field_id: str) -> list[str]:
    options = await _option_locator(page, field_id)
    count = await options.count()
    texts: list[str] = []
    for index in range(count):
        text = _normalize_label((await options.nth(index).inner_text()).strip())
        if text:
            texts.append((await options.nth(index).inner_text()).strip())
    return texts


async def _click_visible_option(page: Page, field_id: str, search_text: str) -> bool:
    query = _normalize_label(search_text)
    options = await _option_locator(page, field_id)
    count = await options.count()
    exact_match = None
    fuzzy_match = None
    for index in range(count):
        option = options.nth(index)
        text = _normalize_label((await option.inner_text()).strip())
        if not text:
            continue
        if text == query:
            exact_match = option
            break
        if len(query) >= 3 and query in text and fuzzy_match is None:
            fuzzy_match = option
    target = exact_match or fuzzy_match
    if target is None:
        return False
    await target.click()
    return True


async def _option_locator(page: Page, field_id: str):
    input_locator = page.locator(_id_selector(field_id)).first
    listbox_id = await input_locator.get_attribute("aria-controls")
    if listbox_id:
        return page.locator(f"[id={json.dumps(listbox_id)}] [role=\"option\"]")
    return page.locator('[role="option"]')


def _missing_profile_fields_for(unknown_required_fields: list[str], defaults: dict) -> list[str]:
    missing: list[str] = []
    for label in unknown_required_fields:
        field_key = _matching_profile_field_key(label)
        if not field_key or defaults.get(field_key):
            continue
        missing.append(field_key)
    return sorted(set(missing))


def _matching_profile_field_key(label: str) -> str | None:
    normalized = _normalize_label(label)
    for field_key, patterns in _KNOWN_PROFILE_FIELD_PATTERNS.items():
        if any(_normalize_label(pattern) in normalized for pattern in patterns):
            return field_key
    return None


async def _wait_for_submission_confirmation(page: Page) -> str:
    """
    Wait up to 30 seconds for any of these success signals after clicking Submit:
      1. Success text pattern in page body
      2. Submit button disappeared from DOM (form replaced by confirmation)
      3. URL changed to a thank-you / confirmation path
    Raises TimeoutError on validation errors or timeout.
    """
    original_url = page.url
    await page.wait_for_timeout(2000)

    for _ in range(60):   # 60 * 500 ms = 30 s
        signal = await _submission_confirmation_signal(page, original_url)
        if signal:
            return signal

        text = await page.locator("body").inner_text()

        # Explicit validation error — fail fast so we don't submit a bad form
        if _SUBMIT_ERROR_RE.search(text):
            raise ValueError(f"Form validation error after submit: {text[:300]}")

        await page.wait_for_timeout(500)

    raise TimeoutError("Submit button did not transition to a confirmation state.")


async def _wait_for_manual_completion(page: Page, timeout_seconds: int = 900) -> str | None:
    """Keep a visible browser open while the user completes a manual checkpoint."""
    original_url = page.url
    for _ in range(max(1, timeout_seconds * 2)):
        if page.is_closed():
            return None
        signal = await _submission_confirmation_signal(page, original_url)
        if signal:
            return signal
        await page.wait_for_timeout(500)
    return None


async def _submission_confirmation_signal(page: Page, original_url: str) -> str | None:
    if page.is_closed():
        return None

    current_url = page.url
    if current_url != original_url:
        if any(tok in current_url for tok in ("success", "thank", "confirmation", "applied", "complete")):
            return f"Redirected to {current_url}"
        if "/apply" in original_url and "/apply" not in current_url:
            return f"Redirected away from apply page: {current_url}"

    text = await page.locator("body").inner_text()
    match = _SUBMIT_SUCCESS_RE.search(text)
    if match:
        return match.group(0)

    if not await page.get_by_role("button", name=re.compile(r"submit application", re.I)).count():
        return "Application submitted (submit button removed from DOM)"

    return None


async def _captcha_block_error(page: Page) -> str | None:
    if not await _has_bot_protection(page):
        return None
    if not await _form_is_valid(page):
        return None
    if not await _submit_button_disabled(page):
        return None
    return (
        "This application is protected by CAPTCHA/reCAPTCHA and cannot be "
        "completed autonomously in the current Playwright flow."
    )


async def _has_bot_protection(page: Page) -> bool:
    markers = await page.evaluate(
        """() => {
            const iframeSrcs = [...document.querySelectorAll('iframe')]
                .map(el => (el.getAttribute('src') || '').toLowerCase());
            const scriptSrcs = [...document.querySelectorAll('script[src]')]
                .map(el => (el.getAttribute('src') || '').toLowerCase());
            return [...iframeSrcs, ...scriptSrcs];
        }"""
    )
    if not isinstance(markers, list):
        return False
    return any(
        any(token in str(item) for token in ("recaptcha", "turnstile", "hcaptcha", "arkose"))
        for item in markers
    )


async def _form_is_valid(page: Page) -> bool:
    return bool(
        await page.evaluate(
            """() => {
                const form = document.querySelector('form');
                return form ? form.checkValidity() : false;
            }"""
        )
    )


async def _submit_button_disabled(page: Page) -> bool:
    button = page.get_by_role("button", name=re.compile(r"submit application", re.I))
    if not await button.count():
        return False
    candidate = button.first
    disabled_attr = await candidate.get_attribute("disabled")
    aria_disabled = (await candidate.get_attribute("aria-disabled") or "").strip().lower()
    return disabled_attr is not None or aria_disabled == "true"


def _write_temp_text_file(content: str, prefix: str) -> Path:
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".txt",
        prefix=prefix,
        delete=False,
    ) as handle:
        handle.write(content)
        return Path(handle.name)
