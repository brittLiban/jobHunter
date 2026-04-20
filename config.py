"""
config.py — All user preferences and system settings in one place.
Override OLLAMA_URL via environment variable for Docker deployments.
"""
import os

# ── Scraping ──────────────────────────────────────────────────────────────────
COMPANY_SLUGS: list[str] = [
    "stripe",
    "figma",
    "notion",
    # Add more Greenhouse company slugs here
]

TARGET_ROLES: list[str] = [
    "software engineer",
    "backend engineer",
    "platform engineer",
    "site reliability engineer",
]

# ── Filtering ─────────────────────────────────────────────────────────────────
PREFERRED_LOCATIONS: list[str] = [
    "remote",
    "seattle",
    "bellevue",
    "new york",
]

MIN_SCORE: int = 60          # Jobs below this score are auto-rejected
PRIORITY_SCORE: int = 80     # Jobs at or above this get full tailoring

# ── LLM ───────────────────────────────────────────────────────────────────────
OLLAMA_MODEL: str = "llama3.1:8b-instruct-q4_K_M"
OLLAMA_URL: str = os.environ.get(
    "OLLAMA_URL", "http://localhost:11434/api/generate"
)
OLLAMA_TIMEOUT: int = 120    # seconds per request
MAX_CONCURRENT_LLM: int = 2  # max simultaneous Ollama calls

# ── Storage ───────────────────────────────────────────────────────────────────
DB_PATH: str = os.environ.get("DB_PATH", "data/jobs.db")

# ── User Profile ──────────────────────────────────────────────────────────────
# Edit this section with your actual information before running.
USER_PROFILE: dict = {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "206-555-0100",
    "resume_text": """\
Jane Smith | jane@example.com | Seattle, WA | github.com/janesmith

SUMMARY
Backend-focused software engineer with 5 years of experience building
distributed systems, REST/gRPC APIs, and data pipelines at scale.

SKILLS
Python, Go, TypeScript, PostgreSQL, Redis, Kafka, Kubernetes, AWS (ECS, RDS,
S3, Lambda), Terraform, Docker, GitHub Actions, Datadog, OpenTelemetry

EXPERIENCE
Senior Software Engineer — Acme Corp (2022–present)
• Redesigned order-processing pipeline in Python/Kafka, cutting p99 latency
  from 3 s to 280 ms and eliminating 12 hours/week of on-call toil.
• Led migration of 8 legacy services from EC2 to ECS Fargate with zero
  downtime, reducing infrastructure cost by 34%.
• Mentored 3 junior engineers; wrote the internal async-Python best-practices
  guide now used across 5 teams.

Software Engineer — Beta Startup (2019–2022)
• Built the billing microservice (Stripe integration) that processed $2 M+ MRR.
• Implemented CI/CD pipelines (GitHub Actions + ArgoCD) reducing deploy time
  from 45 min to 8 min.
• Created a PostgreSQL query-performance monitoring tool that cut slow queries
  by 60% across prod databases.

EDUCATION
B.S. Computer Science — University of Washington, 2019

PROJECTS
• open-search-client — Python async client for OpenSearch with retry/backoff
  and connection pooling (400+ GitHub stars).
""",
    "preferences_json": {
        "preferred_locations": PREFERRED_LOCATIONS,
        "target_roles": TARGET_ROLES,
        "min_salary": 150_000,
        "no_contract": True,
        "no_sponsorship_required": True,
    },
}
