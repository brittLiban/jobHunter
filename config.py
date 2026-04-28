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
]

# ── Greenhouse ATS board slugs ────────────────────────────────────────────────
# Find yours at: https://boards.greenhouse.io/{slug}
GREENHOUSE_BOARD_NAMES: list[str] = [
    # Original targets
    "stripe",
    "figma",
    # Seattle / PNW
    "smartsheet",
    # Remote-friendly / entry-level friendly tech companies
    "asana",
    "duolingo",
    "reddit",
    "discord",
    "dropbox",
    "squarespace",
    "twitch",
    "airbnb",
    "lyft",
    "coinbase",
    "robinhood",
    "brex",
    "gusto",
    "chime",
    "lattice",
    "amplitude",
    "mixpanel",
    "verkada",
    "okta",
    "pagerduty",
    "datadog",
    "mongodb",
    "twilio",
    "cloudflare",
    "elastic",
    "fastly",
    "newrelic",
    "intercom",
    "airtable",
    # New additions - verified active Greenhouse boards
    "instacart",
    "samsara",
    "toast",
    "block",
    "palantir",
    "nerdwallet",
    "affirm",
    "marqeta",
    "onemedical",
    "grammarly",
    "cruise",
    "wealthfront",
    "benchsci",
    "snyk",
    "netlify",
    "dbt-labs",
    "cockroachlabs",
    "grafana",
    "hashicorp",
    "gitlab",
    "sourcegraph",
    "postman",
    "mux",
    "loom",
    "notion-hq",
    "anduril",
    "scale",
    "flexport",
    "rivian",
    "relativity",
    "epic",
    "ramp",
    "applovin",
]

# ── Ashby ATS board slugs ─────────────────────────────────────────────────────
# Verify at: https://jobs.ashbyhq.com/{slug}
ASHBY_BOARD_NAMES: list[str] = [
    "retool",
    "vercel",
    "ramp",
    "mercury",
    "plain",
    "runway",
    "supabase",
    "resend",
    "clerk",
    "inngest",
    "nango",
    "openai",
    "cohere",
    "mistral",
    "perplexity",
    # New additions
    "linear",
    "notion",
    "replit",
    "render",
    "fly",
    "planetscale",
    "convex",
    "modal",
    "huggingface",
    "deepgram",
    "stability",
    "weights-and-biases",
    "anyscale",
    "pinecone",
]

# ── Lever ATS ─────────────────────────────────────────────────────────────────
# Verify at: https://jobs.lever.co/{slug}
LEVER_SITE_NAMES: list[str] = [
    "netflix",
    "spotify",
    # New additions
    "twilio",
    "shopify",
    "atlassian",
    "cloudflare",
    "confluent",
    "sofi",
    "navan",
    "braze",
    "plaid",
    "notion",
]

# ── Workable ──────────────────────────────────────────────────────────────────
WORKABLE_COMPANY_NAMES: list[str] = []

# ── Company career-site crawl targets ────────────────────────────────────────
# Used when the company doesn't use a standard public ATS API.
COMPANY_SITE_TARGETS: list[dict[str, object]] = [
    {
        "name": "stripe",
        "domain": "stripe.com",
        "careers_urls": ["https://stripe.com/jobs/search"],
    },
    {
        "name": "figma",
        "domain": "figma.com",
        "careers_urls": ["https://www.figma.com/careers/"],
    },
    {
        "name": "amazon",
        "domain": "amazon.jobs",
        "careers_urls": [
            "https://www.amazon.jobs/en/search?base_query=software+engineer+intern&loc_query=Seattle",
            "https://www.amazon.jobs/en/search?base_query=new+grad+software+engineer",
        ],
    },
    {
        "name": "microsoft",
        "domain": "careers.microsoft.com",
        "careers_urls": [
            "https://careers.microsoft.com/v2/global/en/search?q=software+engineer+intern&l=en_US",
            "https://careers.microsoft.com/v2/global/en/search?q=new+graduate+software+engineer",
        ],
    },
    {
        "name": "google",
        "domain": "careers.google.com",
        "careers_urls": [
            "https://careers.google.com/jobs/results/?q=software+engineer+intern&location=Seattle",
            "https://careers.google.com/jobs/results/?q=software+engineering+intern+&jex=ENTRY_LEVEL",
        ],
    },
    {
        "name": "apple",
        "domain": "jobs.apple.com",
        "careers_urls": [
            "https://jobs.apple.com/en-us/search?search=software+engineer+intern&sort=relevance",
        ],
    },
    {
        "name": "meta",
        "domain": "metacareers.com",
        "careers_urls": [
            "https://www.metacareers.com/jobs?offices[0]=Seattle%2C%20WA&q=software+engineer+intern",
        ],
    },
    {
        "name": "tmobile",
        "domain": "careers.t-mobile.com",
        "careers_urls": ["https://careers.t-mobile.com/job-search-results/?keyword=software+engineer"],
    },
    {
        "name": "boeing",
        "domain": "boeing.com",
        "careers_urls": ["https://jobs.boeing.com/search-jobs/software%20engineer/185/1"],
    },
    {
        "name": "expedia",
        "domain": "expediagroup.com",
        "careers_urls": ["https://careers.expediagroup.com/jobs?keywords=software+engineer+intern"],
    },
    {
        "name": "indeed",
        "domain": "indeed.com",
        "careers_urls": ["https://www.indeed.com/cmp/Indeed/jobs?q=software+engineer"],
    },
    {
        "name": "spacex",
        "domain": "spacex.com",
        "careers_urls": ["https://www.spacex.com/careers/search/?department=Software"],
    },
]

DEFAULT_RESUME_ROOT = Path(
    os.environ.get(
        "JOB_HUNTER_RESUME_ROOT",
        r"C:\Users\liban\Desktop\01_Career\Resumes",
    )
)
PROFILE_TEXT_ROOT = Path(__file__).parent / "profiles"


def _resume_path(filename: str) -> str:
    return str(DEFAULT_RESUME_ROOT / filename)


def _profile_text_path(filename: str) -> str:
    return str(PROFILE_TEXT_ROOT / filename)


def _variant_resume_text_path(variant: dict[str, object]) -> Path:
    profile_text_path = variant.get("profile_text_path")
    if profile_text_path:
        return Path(str(profile_text_path))
    return Path(str(variant["path"]))


PREFERRED_LOCATIONS: list[str] = [
    "remote",
    "kent",
    "tukwila",
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

# ── Location prefilter regions ───────────────────────────────────────────────
# Controls which broad regions pass the coarse location prefilter.
# Jobs matching ANY of these regions are kept for LLM scoring.
# Set to ["*"] to disable location prefiltering entirely.
ALLOWED_LOCATION_REGIONS: list[str] = [
    "us",           # Anywhere in the United States
    "remote",       # Remote roles (US-remote, fully remote, etc.)
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


COMPANY_SITE_DISCOVERY_ENABLED: bool = _env_bool("COMPANY_SITE_DISCOVERY_ENABLED", True)
SITEMAP_DISCOVERY_ENABLED: bool = _env_bool("SITEMAP_DISCOVERY_ENABLED", True)
DISCOVERY_MAX_PAGES_PER_COMPANY: int = int(os.environ.get("DISCOVERY_MAX_PAGES_PER_COMPANY", "24"))
DISCOVERY_MAX_JOB_URLS_PER_COMPANY: int = int(
    os.environ.get("DISCOVERY_MAX_JOB_URLS_PER_COMPANY", "20")
)


RESUME_VARIANTS: dict[str, dict[str, object]] = {
    "software_engineer": {
        "label": "Software Engineer",
        "path": _resume_path("Liban_Britt_SWE_Current.docx"),
        "profile_text_path": _profile_text_path("liban_britt_software_engineer.md"),
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
        "path": _resume_path("Liban_Britt_PandaDoc_SE_Resume_ATS.docx"),
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
        "path": _resume_path("Liban_Britt_K2United_QA.docx"),
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
        "path": _resume_path("Liban_Britt_Symbotic_Resume_ATS.docx"),
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
        "path": _resume_path("Liban_Britt_DialedInData_Salesforce.docx"),
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
        "path": _resume_path("Liban_Britt_NLP_Resume.docx"),
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
        "path": _resume_path("Liban_Britt_Epicor_SolutionEngineer.docx"),
        "target_roles": [
            "solution engineer",
            "sales engineer",
            "solutions consultant",
            "erp consultant",
        ],
    },
    "test_engineer_qatar": {
        "label": "Test Engineer Qatar",
        "path": _resume_path("Liban_Britt_NairSystems_TestEngineer_Qatar.docx"),
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
ACTIVE_RESUME_TEXT_PATH = _variant_resume_text_path(ACTIVE_RESUME)
TARGET_ROLES: list[str] = list(ACTIVE_RESUME["target_roles"])  # type: ignore[arg-type]


MIN_SCORE: int = 60
PRIORITY_SCORE: int = 80
ENABLE_LOCATION_PREFILTER: bool = True
SCHEDULER_INTERVAL_HOURS: int = int(os.environ.get("SCHEDULER_INTERVAL_HOURS", "1"))
AUTO_APPLY_ENABLED: bool = _env_bool("AUTO_APPLY_ENABLED", True)
AUTO_APPLY_DRY_RUN: bool = _env_bool("AUTO_APPLY_DRY_RUN", False)
AUTO_APPLY_MIN_SCORE: int = int(os.environ.get("AUTO_APPLY_MIN_SCORE", str(PRIORITY_SCORE)))
AUTO_APPLY_MAX_PER_RUN: int | None = _optional_int_from_env(
    "AUTO_APPLY_MAX_PER_RUN",
    20,   # apply up to 20 per pipeline run
)
PLAYWRIGHT_HEADLESS: bool = _env_bool("PLAYWRIGHT_HEADLESS", True)


OLLAMA_MODEL: str = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_URL: str = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_TIMEOUT: int = int(os.environ.get("OLLAMA_TIMEOUT", "300"))
MAX_CONCURRENT_LLM: int = 2
MAX_UNSCORED_JOBS_PER_RUN: int | None = _optional_int_from_env(
    "JOB_HUNTER_MAX_UNSCORED_JOBS_PER_RUN",
    None,   # score all discovered jobs each run
)


DB_PATH: str = os.environ.get("DB_PATH", "data/jobs.db")


USER_PROFILE: dict = {
    "name": "Liban Britt",
    "email": "liban3367@gmail.com",
    "phone": "2534864028",
    "resume_text": load_resume_text(ACTIVE_RESUME_TEXT_PATH),
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
        "resume_text_source_path": str(ACTIVE_RESUME_TEXT_PATH),
        "citizenship": "U.S. Citizen",
        "candidate_profile_summary": (
            "Software developer with two production internships and three years of "
            "hands-on engineering experience building enterprise-class software, "
            "data pipelines, and cloud-deployed systems. Strong OOP fundamentals "
            "in Java, Python, and JavaScript with experience in testing, "
            "debugging, CI/CD, and collaborative development. Local to Kent, WA "
            "and within easy commuting distance of Tukwila, Seattle, Bellevue, "
            "and Redmond. Drawn to mission-driven organizations and "
            "community-centered technology work."
        ),
        "company_motivation_overrides": {
            "becu": (
                "I grew up in this community and care about the kind of financial "
                "access and equity work BECU does."
            ),
        },
        "application_form_defaults": {
            "first_name": "Liban",
            "last_name": "Britt",
            "preferred_name": "Liban",
            "email": "liban3367@gmail.com",
            "phone": "2534864028",
            "phone_country": "United States",
            "country": "United States",
            "work_location_countries": ["US"],
            "location_city": "Kent, Washington, United States",
            "city_state": "Kent, WA",
            "gender": "male",
            "pronouns": "He/Him",
            "veteran_status": "No, I am not a protected veteran",
            "disability_status": "No, I do not have a disability and have not had one in the past",
            "work_authorization_us": "Yes",
            "requires_sponsorship_now_or_future": "No",
            "current_or_previous_employer": "GE Vernova",
            "current_or_previous_job_title": "Software / Data Engineering Intern",
            "plans_remote_if_available": "Yes",
            "whatsapp_recruiting_opt_in": "No",
            "school_name": "Green River College",
            "degree": "Bachelor's Degree",
            "gpa": "",
            "additional_education": [
                {
                    "school_name": "Western Governors University",
                    "degree": "Bachelor's Degree",
                    "discipline": "Supply Chain Management",
                    "start_date_year": "2024",
                }
            ],
            "current_twitch_employee": "No",
            "current_amazon_employee": "No",
            "previous_company_application": "Yes",
            "previous_amazon_employment": "Yes",
            "open_to_relocation": "No",
            "future_opportunities_opt_in": "Yes",
            "non_compete_restriction": "No",
            "held_h1b_last_6_years": "No",
            "familiar_with_company": "Yes",
            "legally_eligible_to_begin_immediately": "Yes",
            "needs_immigration_support_amazon": "No",
            "country_of_citizenship": "United States",
            "custom_question_answers": [
                {
                    "label": "Do you need, or will you need in the future, immigration related support or sponsorship from Amazon?",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "If offered employment by Amazon, would you be legally eligible to begin employment immediately?",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "Have you held H-1B status, or had an H-1B petition approved on your behalf, within the preceding 6 years",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "Are you subject to a non-competition agreement or other agreement that would preclude or restrict your employment at Amazon?",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "Have you previously applied to Amazon or any Amazon subsidiary?",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "Have you previously been employed by Amazon or any Amazon subsidiary?",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "Are you currently a Twitch employee?",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "Are you open to relocation?",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "Would you like to be considered for future opportunities at Twitch when you apply?",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "Are you familiar with Twitch?",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "are you familiar with twitch",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "are you open to relocation",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "are you subject to a non competition agreement or other agreement that would preclude or restrict your employment at amazon",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "have you held h 1b status or had an h 1b petition approved on your behalf within the preceding 6 years for an employer other than a cap exempt institution",
                    "value": "No",
                    "kind": "select",
                },
                {
                    "label": "have you previously applied to amazon or any amazon subsidiary",
                    "value": "Yes",
                    "kind": "select",
                },
                {
                    "label": "would you like to be considered for future opportunities at twitch when you apply",
                    "value": "Yes",
                    "kind": "select",
                },
            ],
            "links": "LinkedIn: https://linkedin.com/in/liban-britt-3981a587 | GitHub: https://github.com/brittLiban",
            "location_preferences": [
                "Tukwila, WA, United States",
                "Seattle, WA, United States",
                "Bellevue, WA, United States",
            ],
            "self_identification_acknowledgement": "I understand that self-identification is voluntary.",
            "hispanic_ethnicity": "",
            "conference_history": "",
            # Education details (needed for intern/new-grad forms)
            "discipline": "Software Development",
            "graduation_year": "",
            "start_date_year": "2024",
            "sat_act_score": "",
            # Stripe-specific
            "stripe_employment_history": "No",
            "why_fit": "",   # populated from LLM tailor output at apply time
        },
    },
}
