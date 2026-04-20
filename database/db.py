"""
database/db.py — All SQLite operations for the Job Hunter system.

Connection is created fresh per call (SQLite is not thread-safe with shared
connections, and asyncio tasks may run on multiple threads via executors).
Row factory returns dict-like sqlite3.Row objects.
"""
import json
import sqlite3
from pathlib import Path
from typing import Any

import config


# ── Connection ────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    """Open and return a new SQLite connection with Row factory set."""
    db_path = Path(config.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


# ── Init ──────────────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create tables from schema.sql if they don't exist."""
    schema_path = Path(__file__).parent / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")
    with _get_conn() as conn:
        conn.executescript(sql)


# ── User Profile ──────────────────────────────────────────────────────────────

def seed_user_profile(profile: dict) -> None:
    """Insert the user profile if it doesn't already exist."""
    with _get_conn() as conn:
        existing = conn.execute("SELECT id FROM user_profile LIMIT 1").fetchone()
        if not existing:
            conn.execute(
                """INSERT INTO user_profile
                   (name, email, phone, resume_text, preferences_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    profile["name"],
                    profile["email"],
                    profile["phone"],
                    profile["resume_text"],
                    json.dumps(profile["preferences_json"]),
                ),
            )


def get_user_profile() -> dict | None:
    """Return the user profile row as a plain dict, or None if absent."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM user_profile LIMIT 1").fetchone()
    if row is None:
        return None
    d = dict(row)
    d["preferences_json"] = json.loads(d["preferences_json"] or "{}")
    return d


def update_user_profile(**kwargs: Any) -> None:
    """Update arbitrary columns in user_profile."""
    if not kwargs:
        return
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values())
    with _get_conn() as conn:
        conn.execute(f"UPDATE user_profile SET {sets}", vals)


# ── Jobs ──────────────────────────────────────────────────────────────────────

def insert_job(job: dict) -> int | None:
    """
    Insert a job record.  Returns the new row id, or None if the URL already
    exists (deduplication by URL via UNIQUE constraint).
    """
    with _get_conn() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO jobs
                   (title, company, location, salary_min, salary_max,
                    description, url, source, raw_html)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    job["title"],
                    job["company"],
                    job.get("location"),
                    job.get("salary_min"),
                    job.get("salary_max"),
                    job.get("description"),
                    job["url"],
                    job.get("source", "greenhouse"),
                    job.get("raw_html"),
                ),
            )
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None


def get_unscored_jobs() -> list[sqlite3.Row]:
    """Return jobs that have no application record yet."""
    with _get_conn() as conn:
        return conn.execute(
            """SELECT j.*
               FROM jobs j
               LEFT JOIN applications a ON j.id = a.job_id
               WHERE a.id IS NULL"""
        ).fetchall()


def get_job(job_id: int) -> sqlite3.Row | None:
    with _get_conn() as conn:
        return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def get_all_jobs_with_applications() -> list[sqlite3.Row]:
    """Full join used by the dashboard."""
    with _get_conn() as conn:
        return conn.execute(
            """SELECT j.id          AS job_id,
                      j.title,
                      j.company,
                      j.location,
                      j.url,
                      j.description,
                      j.date_found,
                      a.id          AS app_id,
                      a.fit_score,
                      a.apply_decision,
                      a.status,
                      a.tailored_summary,
                      a.cover_letter,
                      a.notes,
                      a.scorer_data,
                      a.extracted_data,
                      a.tailor_data,
                      a.applied_at,
                      a.follow_up_date
               FROM jobs j
               LEFT JOIN applications a ON j.id = a.job_id
               ORDER BY a.fit_score DESC NULLS LAST"""
        ).fetchall()


def get_distinct_companies() -> list[str]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT company FROM jobs ORDER BY company"
        ).fetchall()
    return [r["company"] for r in rows]


# ── Applications ──────────────────────────────────────────────────────────────

def create_application(job_id: int, status: str = "found") -> int:
    """Create a new application row and return its id."""
    with _get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO applications (job_id, status) VALUES (?, ?)",
            (job_id, status),
        )
        return cur.lastrowid


def update_application(app_id: int, **kwargs: Any) -> None:
    """Update arbitrary columns on an application row."""
    if not kwargs:
        return
    # Allowlist to prevent accidental column injection from internal callers
    allowed = {
        "fit_score", "apply_decision", "tailored_summary", "cover_letter",
        "status", "applied_at", "follow_up_date", "notes",
        "extracted_data", "scorer_data", "tailor_data",
    }
    filtered = {k: v for k, v in kwargs.items() if k in allowed}
    if not filtered:
        return
    sets = ", ".join(f"{k} = ?" for k in filtered)
    vals = list(filtered.values()) + [app_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE applications SET {sets} WHERE id = ?", vals)


def get_application_by_job(job_id: int) -> sqlite3.Row | None:
    with _get_conn() as conn:
        return conn.execute(
            "SELECT * FROM applications WHERE job_id = ?", (job_id,)
        ).fetchone()


# ── Stats ─────────────────────────────────────────────────────────────────────

def get_stats() -> dict:
    with _get_conn() as conn:
        total_jobs   = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
        total_scored = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE fit_score IS NOT NULL"
        ).fetchone()[0]
        total_applied = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE status = 'applied'"
        ).fetchone()[0]
        total_priority = conn.execute(
            f"SELECT COUNT(*) FROM applications WHERE fit_score >= {config.PRIORITY_SCORE}"
        ).fetchone()[0]
        avg_score_row = conn.execute(
            "SELECT AVG(fit_score) FROM applications WHERE fit_score IS NOT NULL"
        ).fetchone()
        avg_score = round(avg_score_row[0] or 0.0, 1)
        total_filtered = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE status = 'filtered'"
        ).fetchone()[0]
    return {
        "total_jobs": total_jobs,
        "total_scored": total_scored,
        "total_applied": total_applied,
        "total_priority": total_priority,
        "avg_score": avg_score,
        "total_filtered": total_filtered,
    }
