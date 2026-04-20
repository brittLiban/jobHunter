"""
Central configuration for the Job Hunter system.

This file now supports named resume variants sourced directly from the user's
local DOCX files. Set JOB_HUNTER_RESUME_KEY to switch the active variant
without editing code.
"""
from __future__ import annotations

import os
from pathlib import Path

from resume_loader import load_resume_text


COMPANY_SLUGS: list[str] = [
    "stripe",
    "figma",
    # Add more verified Greenhouse slugs here.
]

PREFERRED_LOCATIONS: list[str] = [
    "remote",
    "kent",
    "seattle",
    "bellevue",
    "redmond",
    "tacoma",
    "kirkland",
    "renton",
    "issaquah",
    "everett",
    "lynnwood",
]

DISALLOWED_REMOTE_LOCATION_KEYWORDS: list[str] = [
    "canada",
    "can-remote",
    "toronto",
    "mexico",
    "dublin",
    "ireland",
    "tokyo",
    "japan",
    "australia",
    "sydney",
    "bengaluru",
    "bangalore",
    "india",
    "singapore",
    "london",
    "england",
    "united kingdom",
    "uk",
    "tel aviv",
    "israel",
]

EXCLUDED_TITLE_KEYWORDS: list[str] = [
    "staff",
    "senior",
    "sr.",
    "principal",
    "lead",
    "manager",
    "director",
    "head",
    "architect",
]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _optional_int_from_env(name: str, default: int | None) -> int | None:
    raw = os.environ.get(name)
    if raw is None:
        return default

    value = raw.strip().lower()
    if value in {"", "none", "all", "unlimited"}:
        return None

    parsed = int(value)
    return max(1, parsed)


RESUME_VARIANTS: dict[str, dict[str, object]] = {
    "software_engineer": {
        "label": "Software Engineer",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_SWE.docx",
        "target_roles": [
            "software engineer",
            "backend engineer",
            "integration engineer",
            "platform engineer",
            "software engineer intern",
            "engineering intern",
            "associate software engineer",
            "junior software engineer",
            "new grad",
            "early career",
        ],
    },
    "solution_engineer": {
        "label": "Solution Engineer",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_PandaDoc_SE_Resume_ATS.docx",
        "target_roles": [
            "solution engineer",
            "sales engineer",
            "solutions consultant",
            "pre sales engineer",
            "solutions architect",
        ],
    },
    "qa_engineer": {
        "label": "QA / Test Engineer",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_K2United_QA.docx",
        "target_roles": [
            "qa engineer",
            "quality assurance engineer",
            "test engineer",
            "quality engineer",
            "software test engineer",
        ],
    },
    "system_field_analyst": {
        "label": "System Field Analyst",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_Symbotic_Resume_ATS.docx",
        "target_roles": [
            "system field analyst",
            "field engineer",
            "systems analyst",
            "integration analyst",
            "operations analyst",
        ],
    },
    "salesforce_admin": {
        "label": "Salesforce / RevOps",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_DialedInData_Salesforce.docx",
        "target_roles": [
            "salesforce administrator",
            "salesforce analyst",
            "sales operations analyst",
            "crm administrator",
            "revenue operations analyst",
        ],
    },
    "nlp_engineer": {
        "label": "NLP / AI Engineer",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_NLP_Resume.docx",
        "target_roles": [
            "machine learning engineer",
            "nlp engineer",
            "ai engineer",
            "data scientist",
            "software engineer",
        ],
    },
    "erp_solution_engineer": {
        "label": "ERP Solution Engineer",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_Epicor_SolutionEngineer.docx",
        "target_roles": [
            "solution engineer",
            "sales engineer",
            "solutions consultant",
            "erp consultant",
        ],
    },
    "test_engineer_qatar": {
        "label": "Test Engineer Qatar",
        "path": r"C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_NairSystems_TestEngineer_Qatar.docx",
        "target_roles": [
            "test engineer",
            "qa engineer",
            "system test engineer",
            "integration test engineer",
        ],
    },
}

ACTIVE_RESUME_KEY: str = os.environ.get("JOB_HUNTER_RESUME_KEY", "software_engineer")
if ACTIVE_RESUME_KEY not in RESUME_VARIANTS:
    valid = ", ".join(sorted(RESUME_VARIANTS))
    raise ValueError(
        f"Unknown JOB_HUNTER_RESUME_KEY={ACTIVE_RESUME_KEY!r}. Valid keys: {valid}"
    )

ACTIVE_RESUME = RESUME_VARIANTS[ACTIVE_RESUME_KEY]
ACTIVE_RESUME_PATH = Path(str(ACTIVE_RESUME["path"]))
TARGET_ROLES: list[str] = list(ACTIVE_RESUME["target_roles"])  # type: ignore[arg-type]


MIN_SCORE: int = 60
PRIORITY_SCORE: int = 80
ENABLE_LOCATION_PREFILTER: bool = True
SCHEDULER_INTERVAL_HOURS: int = int(os.environ.get("SCHEDULER_INTERVAL_HOURS", "6"))
AUTO_APPLY_ENABLED: bool = _env_bool("AUTO_APPLY_ENABLED", False)
AUTO_APPLY_DRY_RUN: bool = _env_bool("AUTO_APPLY_DRY_RUN", False)
AUTO_APPLY_MIN_SCORE: int = int(os.environ.get("AUTO_APPLY_MIN_SCORE", str(PRIORITY_SCORE)))
AUTO_APPLY_MAX_PER_RUN: int | None = _optional_int_from_env(
    "AUTO_APPLY_MAX_PER_RUN",
    3,
)
PLAYWRIGHT_HEADLESS: bool = _env_bool("PLAYWRIGHT_HEADLESS", True)


OLLAMA_MODEL: str = "llama3.1:8b-instruct-q4_K_M"
OLLAMA_URL: str = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_TIMEOUT: int = int(os.environ.get("OLLAMA_TIMEOUT", "300"))
MAX_CONCURRENT_LLM: int = 2
MAX_UNSCORED_JOBS_PER_RUN: int | None = _optional_int_from_env(
    "JOB_HUNTER_MAX_UNSCORED_JOBS_PER_RUN",
    8,
)


DB_PATH: str = os.environ.get("DB_PATH", "data/jobs.db")


USER_PROFILE: dict = {
    "name": "Liban Britt",
    "email": "liban3367@gmail.com",
    "phone": "2534864028",
    "resume_text": load_resume_text(ACTIVE_RESUME_PATH),
    "preferences_json": {
        "preferred_locations": PREFERRED_LOCATIONS,
        "target_roles": TARGET_ROLES,
        "experience_level": "entry",
        "internships_ok": True,
        "excluded_title_keywords": EXCLUDED_TITLE_KEYWORDS,
        "disallowed_remote_location_keywords": DISALLOWED_REMOTE_LOCATION_KEYWORDS,
        "min_salary": 90000,
        "no_contract": True,
        "no_sponsorship_required": True,
        "resume_variant_key": ACTIVE_RESUME_KEY,
        "resume_variant_label": ACTIVE_RESUME["label"],
        "resume_source_path": str(ACTIVE_RESUME_PATH),
        "citizenship": "U.S. Citizen",
        "application_form_defaults": {
            "first_name": "Liban",
            "last_name": "Britt",
            "preferred_name": "Liban",
            "email": "liban3367@gmail.com",
            "phone": "2534864028",
            "phone_country": "United States",
            "country": "United States",
            "location_city": "Kent, WA",
            "city_state": "Kent, WA",
            "gender": "male",
            "pronouns": "He/Him",
            "veteran_status": "No, I am not a protected veteran",
            "disability_status": "No, I do not have a disability and have not had one in the past",
            "work_authorization_us": "Yes",
            "requires_sponsorship_now_or_future": "No",
            "current_or_previous_employer": "TekCare LLC",
            "current_or_previous_job_title": "Lead Software Engineer",
            "school_name": "University of Washington",
            "degree": "B.A.S. Software Development & Data Analytics",
            "gpa": "3.8",
            "links": "LinkedIn: https://linkedin.com/in/liban-britt-3981a587 | GitHub: https://github.com/brittLiban",
            "location_preferences": [
                "Seattle, WA, United States",
                "Bellevue, WA, United States",
                "Redmond, WA, United States",
            ],
            "self_identification_acknowledgement": "I understand that self-identification is voluntary.",
            "hispanic_ethnicity": "",
            "conference_history": "",
        },
    },
}
