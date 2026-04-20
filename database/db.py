"""
database/db.py - SQLite operations for the Job Hunter system.

Connections are created per call so the pipeline and dashboard can safely use
SQLite from separate tasks or processes.
"""
import json
import sqlite3
from pathlib import Path
from typing import Any

import config


def _get_conn() -> sqlite3.Connection:
    """Open and return a new SQLite connection with Row factory set."""
    db_path = Path(config.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    """Create tables from schema.sql if they do not exist."""
    schema_path = Path(__file__).parent / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")
    with _get_conn() as conn:
        conn.executescript(sql)
        _ensure_column(conn, "applications", "apply_data", "TEXT")


def seed_user_profile(profile: dict) -> str:
    """
    Ensure a usable user profile exists.

    Returns one of: "inserted", "updated", or "unchanged".
    Existing non-placeholder profiles are left intact so dashboard edits are
    not overwritten on every pipeline run.
    """
    with _get_conn() as conn:
        existing = conn.execute("SELECT * FROM user_profile LIMIT 1").fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO user_profile (name, email, phone, resume_text, preferences_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    profile["name"],
                    profile["email"],
                    profile["phone"],
                    profile["resume_text"],
                    json.dumps(profile["preferences_json"]),
                ),
            )
            return "inserted"

        existing_dict = dict(existing)
        existing_preferences = _load_preferences_json(existing_dict.get("preferences_json"))
        if _should_sync_active_resume_variant(existing_preferences, profile["preferences_json"]):
            conn.execute(
                """
                UPDATE user_profile
                SET name = ?, email = ?, phone = ?, resume_text = ?, preferences_json = ?
                WHERE id = ?
                """,
                (
                    profile["name"],
                    profile["email"],
                    profile["phone"],
                    profile["resume_text"],
                    json.dumps(profile["preferences_json"]),
                    existing_dict["id"],
                ),
            )
            return "updated"
        if not _should_replace_bootstrap_profile(existing_dict, existing_preferences):
            return "unchanged"

        conn.execute(
            """
            UPDATE user_profile
            SET name = ?, email = ?, phone = ?, resume_text = ?, preferences_json = ?
            WHERE id = ?
            """,
            (
                profile["name"],
                profile["email"],
                profile["phone"],
                profile["resume_text"],
                json.dumps(profile["preferences_json"]),
                existing_dict["id"],
            ),
        )
        return "updated"


def get_user_profile() -> dict | None:
    """Return the single user profile row as a plain dict, or None."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM user_profile LIMIT 1").fetchone()

    if row is None:
        return None

    profile = dict(row)
    profile["preferences_json"] = _load_preferences_json(profile.get("preferences_json"))
    return profile


def update_user_profile(**kwargs: Any) -> None:
    """Update arbitrary columns in user_profile."""
    if not kwargs:
        return

    sets = ", ".join(f"{key} = ?" for key in kwargs)
    values = list(kwargs.values())
    with _get_conn() as conn:
        conn.execute(f"UPDATE user_profile SET {sets}", values)


def _ensure_column(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_sql: str,
) -> None:
    existing = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    if any(row["name"] == column_name for row in existing):
        return
    conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")


def _load_preferences_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _should_replace_bootstrap_profile(existing: dict, preferences: dict) -> bool:
    placeholder_names = {"", "jane smith"}
    placeholder_emails = {"", "jane@example.com"}

    name = str(existing.get("name") or "").strip().lower()
    email = str(existing.get("email") or "").strip().lower()
    resume_text = str(existing.get("resume_text") or "").strip()
    resume_variant_key = preferences.get("resume_variant_key")
    resume_source_path = preferences.get("resume_source_path")

    return any(
        (
            name in placeholder_names,
            email in placeholder_emails,
            len(resume_text) < 200,
            not resume_variant_key,
            not resume_source_path,
        )
    )


def _should_sync_active_resume_variant(existing_preferences: dict, desired_preferences: dict) -> bool:
    existing_variant = existing_preferences.get("resume_variant_key")
    desired_variant = desired_preferences.get("resume_variant_key")
    if not existing_variant or not desired_variant:
        return False
    if existing_variant != desired_variant:
        return False

    return any(
        (
            existing_preferences.get("resume_source_path")
            != desired_preferences.get("resume_source_path"),
            existing_preferences.get("resume_text_source_path")
            != desired_preferences.get("resume_text_source_path"),
        )
    )


def insert_job(job: dict) -> int | None:
    """
    Insert a job record.

    Returns the new row id, or None if the URL already exists.
    """
    with _get_conn() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO jobs (
                    title,
                    company,
                    location,
                    salary_min,
                    salary_max,
                    description,
                    url,
                    source,
                    raw_html
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
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
    """
    Return jobs that still need scoring work.

    This includes:
    - jobs with no application row yet
    - jobs whose application row exists but is still in the initial "found"
      state with no fit score, which lets interrupted runs resume cleanly
    """
    with _get_conn() as conn:
        return conn.execute(
            """
            SELECT
                j.*,
                a.id AS app_id,
                a.status AS application_status,
                a.fit_score AS application_fit_score,
                a.extracted_data AS application_extracted_data
            FROM jobs j
            LEFT JOIN applications a ON j.id = a.job_id
            WHERE
                a.id IS NULL
                OR (
                    a.fit_score IS NULL
                    AND COALESCE(a.status, 'found') = 'found'
                )
            ORDER BY
                CASE
                    WHEN a.id IS NOT NULL
                    AND a.extracted_data IS NOT NULL
                    AND a.fit_score IS NULL
                    AND COALESCE(a.status, 'found') = 'found' THEN 0
                    WHEN a.id IS NULL THEN 1
                    ELSE 2
                END,
                j.date_found DESC,
                j.id DESC
            """
        ).fetchall()


def get_job(job_id: int) -> sqlite3.Row | None:
    with _get_conn() as conn:
        return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def get_all_jobs_with_applications() -> list[sqlite3.Row]:
    """Return jobs joined to their application row for the dashboard."""
    with _get_conn() as conn:
        return conn.execute(
            """
            SELECT
                j.id AS job_id,
                j.title,
                j.company,
                j.location,
                j.url,
                j.description,
                j.date_found,
                a.id AS app_id,
                a.fit_score,
                a.apply_decision,
                a.status,
                a.tailored_summary,
                a.cover_letter,
                a.notes,
                a.scorer_data,
                a.extracted_data,
                a.tailor_data,
                a.apply_data,
                a.applied_at,
                a.follow_up_date
            FROM jobs j
            LEFT JOIN applications a ON j.id = a.job_id
            ORDER BY
                CASE WHEN a.fit_score IS NULL THEN 1 ELSE 0 END,
                a.fit_score DESC,
                j.date_found DESC,
                j.id DESC
            """
        ).fetchall()


def get_distinct_companies() -> list[str]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT company FROM jobs ORDER BY company").fetchall()
    return [row["company"] for row in rows]


def get_distinct_sources() -> list[str]:
    with _get_conn() as conn:
        rows = conn.execute("SELECT DISTINCT source FROM jobs ORDER BY source").fetchall()
    return [row["source"] for row in rows if row["source"]]


def create_application(job_id: int, status: str = "found") -> int:
    """
    Create an application row if one does not exist and return its id.

    BEGIN IMMEDIATE serializes writers so parallel pipeline runs cannot insert
    two application rows for the same job.
    """
    with _get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT id FROM applications WHERE job_id = ? ORDER BY id LIMIT 1",
            (job_id,),
        ).fetchone()
        if existing is not None:
            return existing["id"]

        cur = conn.execute(
            "INSERT INTO applications (job_id, status) VALUES (?, ?)",
            (job_id, status),
        )
        return cur.lastrowid


def update_application(app_id: int | None, **kwargs: Any) -> None:
    """Update arbitrary columns on an application row."""
    if app_id is None or not kwargs:
        return

    allowed = {
        "fit_score",
        "apply_decision",
        "tailored_summary",
        "cover_letter",
        "status",
        "applied_at",
        "follow_up_date",
        "notes",
        "extracted_data",
        "scorer_data",
        "tailor_data",
        "apply_data",
    }
    filtered = {key: value for key, value in kwargs.items() if key in allowed}
    if not filtered:
        return

    sets = ", ".join(f"{key} = ?" for key in filtered)
    values = list(filtered.values()) + [app_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE applications SET {sets} WHERE id = ?", values)


def get_application_by_job(job_id: int) -> sqlite3.Row | None:
    with _get_conn() as conn:
        return conn.execute(
            "SELECT * FROM applications WHERE job_id = ? ORDER BY id LIMIT 1",
            (job_id,),
        ).fetchone()


def get_auto_apply_jobs(limit: int | None = None) -> list[sqlite3.Row]:
    """
    Return scored jobs that are recommended for application and not yet applied.

    Auto-apply is intentionally conservative: it only targets scored jobs with an
    affirmative apply decision and a score at or above config.AUTO_APPLY_MIN_SCORE.
    """
    sql = """
        SELECT
            j.id AS job_id,
            j.title,
            j.company,
            j.location,
            j.url,
            j.source,
            j.description,
            j.date_found,
            a.id AS app_id,
            a.fit_score,
            a.apply_decision,
            a.status,
            a.tailored_summary,
            a.cover_letter,
            a.notes,
            a.scorer_data,
            a.extracted_data,
            a.tailor_data,
            a.apply_data,
            a.applied_at,
            a.follow_up_date
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        WHERE
            a.status = 'scored'
            AND COALESCE(a.apply_decision, 0) = 1
            AND COALESCE(a.fit_score, 0) >= ?
        ORDER BY a.fit_score DESC, j.date_found DESC, a.id DESC
    """
    params: list[Any] = [config.AUTO_APPLY_MIN_SCORE]

    with _get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    filtered = [
        row
        for row in rows
        if _supports_auto_apply_source(row["source"], row["url"])
        and _should_retry_auto_apply(row["apply_data"])
    ]
    if limit is not None:
        return filtered[:limit]
    return filtered


def _supports_auto_apply_source(source: str | None, url: str | None) -> bool:
    source_lower = str(source or "").strip().lower()
    url_lower = str(url or "").strip().lower()
    return source_lower == "greenhouse" or "greenhouse" in url_lower or "gh_jid=" in url_lower


def _should_retry_auto_apply(raw_apply_data: str | None) -> bool:
    if not raw_apply_data:
        return True

    try:
        payload = json.loads(raw_apply_data)
    except json.JSONDecodeError:
        return True

    if not isinstance(payload, dict):
        return True

    retryable = payload.get("retryable")
    if isinstance(retryable, bool):
        return retryable

    error = str(payload.get("error") or "").strip().lower()
    blocked_reason = str(payload.get("blocked_reason") or "").strip().lower()
    if blocked_reason in {"unsupported_source", "missing_profile_fields", "unknown_required_fields"}:
        return False
    if error.startswith("no submitter is registered"):
        return False
    if error == "unknown required application fields remain.":
        return False
    return True


def get_stats() -> dict:
    with _get_conn() as conn:
        total_jobs = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
        total_scored = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE fit_score IS NOT NULL"
        ).fetchone()[0]
        total_applied = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE status = 'applied'"
        ).fetchone()[0]
        total_priority = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE fit_score >= ?",
            (config.PRIORITY_SCORE,),
        ).fetchone()[0]
        avg_score_row = conn.execute(
            "SELECT AVG(fit_score) FROM applications WHERE fit_score IS NOT NULL"
        ).fetchone()
        total_filtered = conn.execute(
            "SELECT COUNT(*) FROM applications WHERE status = 'filtered'"
        ).fetchone()[0]

    return {
        "total_jobs": total_jobs,
        "total_scored": total_scored,
        "total_applied": total_applied,
        "total_priority": total_priority,
        "avg_score": round(avg_score_row[0] or 0.0, 1),
        "total_filtered": total_filtered,
    }
