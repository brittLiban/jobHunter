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

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=config.PLAYWRIGHT_HEADLESS)
            page = await browser.new_page()
            try:
                logger.info("[Apply/Greenhouse] Opening %s", apply_url)
                await page.goto(apply_url, wait_until="networkidle")

                required_labels = await _get_required_label_texts(page)
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
                    # Location preferences
                    _Rule("What is your first location preference?", _location_preference(defaults, 0), "select"),
                    _Rule("Second location preference", _location_preference(defaults, 1), "select"),
                    _Rule("Third location preference", _location_preference(defaults, 2), "select"),
                    # Work authorization
                    _Rule("Are you currently eligible to work in the United States?", defaults.get("work_authorization_us_text"), "select"),
                    _Rule("Do you require visa sponsorship, now or in the future, to continue working in the United States?", defaults.get("requires_sponsorship_text"), "select"),
                    # Employment history
                    _Rule("Who is your current or previous employer?", defaults.get("current_or_previous_employer"), "text"),
                    _Rule("What is your current or previous job title?", defaults.get("current_or_previous_job_title"), "text"),
                    _Rule("If located in the US, in what city and state do you reside?", defaults.get("city_state"), "text"),
                    # EEO / self-ID
                    _Rule("Self-identification is voluntary. Please acknowledge this in the drop down below.", defaults.get("self_identification_acknowledgement"), "select"),
                    _Rule("Gender", defaults.get("gender_text"), "select"),
                    _Rule("Are you Hispanic/Latino?", defaults.get("hispanic_ethnicity"), "select"),
                    _Rule("Veteran Status", defaults.get("veteran_status"), "select"),
                    _Rule("Disability Status", defaults.get("disability_status"), "select"),
                ]

                for rule in rules:
                    if not rule.value:
                        continue
                    if not await _label_exists(page, rule.label):
                        continue
                    if rule.kind == "select":
                        await _select_option(page, rule.label, str(rule.value))
                    else:
                        await _fill_text_field(page, rule.label, str(rule.value))
                    filled_fields.append(rule.label)
                    handled_required_patterns.add(_normalize_label(rule.label))

                unknown_required_fields = sorted(
                    label
                    for label in required_labels
                    if not any(pattern in label for pattern in handled_required_patterns)
                )
                if unknown_required_fields:
                    return ApplyResult(
                        source=self.SOURCE_NAME,
                        apply_url=apply_url,
                        success=False,
                        submitted=False,
                        dry_run=dry_run,
                        error="Unknown required application fields remain.",
                        filled_fields=filled_fields,
                        skipped_optional_fields=skipped_optional_fields,
                        unknown_required_fields=unknown_required_fields,
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
                    )

                await page.get_by_role("button", name=re.compile(r"submit application", re.I)).click()
                confirmation_text = await _wait_for_submission_confirmation(page)
                return ApplyResult(
                    source=self.SOURCE_NAME,
                    apply_url=apply_url,
                    success=True,
                    submitted=True,
                    dry_run=False,
                    filled_fields=filled_fields,
                    skipped_optional_fields=skipped_optional_fields,
                    confirmation_text=confirmation_text,
                )
            except Exception as exc:
                return ApplyResult(
                    source=self.SOURCE_NAME,
                    apply_url=apply_url,
                    success=False,
                    submitted=False,
                    dry_run=dry_run,
                    error=str(exc),
                    filled_fields=filled_fields,
                    skipped_optional_fields=skipped_optional_fields,
                )
            finally:
                if temp_cover_letter_path is not None and temp_cover_letter_path.exists():
                    temp_cover_letter_path.unlink(missing_ok=True)
                await browser.close()


class _Rule:
    def __init__(self, label: str, value: str | None, kind: str) -> None:
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
    defaults.setdefault("first_name", first_name)
    defaults.setdefault("last_name", last_name)
    defaults.setdefault("preferred_name", first_name)
    defaults.setdefault("email", profile.get("email") or "")
    defaults.setdefault("phone", profile.get("phone") or "")
    defaults.setdefault("resume_path", prefs.get("resume_source_path") or str(config.ACTIVE_RESUME_PATH))
    defaults.setdefault("phone_country", "United States")
    defaults.setdefault("location_city", "Kent, WA")
    defaults.setdefault("city_state", "Kent, WA")
    defaults.setdefault(
        "work_authorization_us_text",
        "Yes, I am currently eligible to work in the country where this role is based.",
    )
    defaults.setdefault(
        "requires_sponsorship_text",
        "No, I do not require visa sponsorship now or in the future to continue working in the country where this role is based.",
    )
    defaults.setdefault("gender_text", _title_case_gender(defaults.get("gender")))
    defaults.setdefault("stripe_employment_history", "No")
    defaults.setdefault("why_fit", _build_why_fit_text(job, profile))
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

    title = job.get("title") or "this role"
    company = job.get("company") or "your team"
    return (
        f"I am an entry-level software engineer based in Kent, Washington with hands-on "
        f"experience from production internships, backend development, testing, and cloud "
        f"delivery. I am applying to {title} at {company} because the role aligns with my "
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


async def _get_required_label_texts(page: Page) -> set[str]:
    labels = page.locator("label")
    count = await labels.count()
    required: set[str] = set()
    for index in range(count):
        text = (await labels.nth(index).inner_text()).strip()
        if "*" not in text:
            continue
        required.add(_normalize_label(text))
    return required


def _normalize_label(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("*", "")).strip().lower()


async def _label_exists(page: Page, label_text: str) -> bool:
    return await page.locator("label").filter(has_text=label_text).count() > 0


async def _fill_text_field(page: Page, label_text: str, value: str) -> None:
    if not value:
        return
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(f"#{field_id}")
    await locator.scroll_into_view_if_needed()
    await locator.click()
    await locator.fill(value)


async def _select_option(page: Page, label_text: str, search_text: str) -> None:
    if not search_text:
        return
    field_id = await _get_field_id(page, label_text)
    locator = page.locator(f"#{field_id}")
    await locator.scroll_into_view_if_needed()
    await locator.click()
    await locator.fill(search_text)

    option = page.locator('[role="option"]').filter(has_text=search_text).first
    try:
        await option.wait_for(timeout=5000)
        await option.click()
    except PlaywrightTimeoutError:
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")


async def _get_field_id(page: Page, label_text: str) -> str:
    label = page.locator("label").filter(has_text=label_text).first
    count = await label.count()
    if count == 0:
        raise ValueError(f"Field label not found: {label_text}")
    field_id = await label.get_attribute("for")
    if not field_id:
        raise ValueError(f"Field label does not reference an input: {label_text}")
    return field_id


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
        current_url = page.url

        # Navigation-based success (Stripe redirects to /jobs/*/success)
        if current_url != original_url:
            if any(tok in current_url for tok in ("success", "thank", "confirmation", "applied", "complete")):
                return f"Redirected to {current_url}"
            # Any navigation away from the apply URL is treated as success
            if "/apply" in original_url and "/apply" not in current_url:
                return f"Redirected away from apply page: {current_url}"

        text = await page.locator("body").inner_text()

        # Explicit success phrase in body
        match = _SUBMIT_SUCCESS_RE.search(text)
        if match:
            return match.group(0)

        # Submit button disappeared → form replaced by confirmation widget
        if not await page.get_by_role("button", name=re.compile(r"submit application", re.I)).count():
            return "Application submitted (submit button removed from DOM)"

        # Explicit validation error — fail fast so we don't submit a bad form
        if _SUBMIT_ERROR_RE.search(text):
            raise ValueError(f"Form validation error after submit: {text[:300]}")

        await page.wait_for_timeout(500)

    raise TimeoutError("Submit button did not transition to a confirmation state.")


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
