-- schema.sql — SQLite schema for the Job Hunter system.

CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    company     TEXT    NOT NULL,
    location    TEXT,
    salary_min  INTEGER,
    salary_max  INTEGER,
    description TEXT,
    url         TEXT    UNIQUE NOT NULL,
    source      TEXT    DEFAULT 'greenhouse',
    date_found  DATETIME DEFAULT CURRENT_TIMESTAMP,
    raw_html    TEXT            -- stores raw API JSON as text
);

CREATE TABLE IF NOT EXISTS applications (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id           INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    fit_score        INTEGER,
    apply_decision   INTEGER,   -- 0 = no, 1 = yes (SQLite has no BOOL)
    tailored_summary TEXT,
    cover_letter     TEXT,
    status           TEXT    DEFAULT 'found',
                              -- found | scored | filtered | applied
                              -- rejected | interview | offer | skipped
    applied_at       DATETIME,
    follow_up_date   DATETIME,
    notes            TEXT,
    extracted_data   TEXT,   -- JSON: ExtractedJob
    scorer_data      TEXT,   -- JSON: JobScore
    tailor_data      TEXT,   -- JSON: TailoredResume + ApplicationAnswers
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profile (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT,
    email            TEXT,
    phone            TEXT,
    resume_text      TEXT,
    preferences_json TEXT    -- JSON blob
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_applications_job_id    ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status    ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_fit_score ON applications(fit_score);
CREATE INDEX IF NOT EXISTS idx_jobs_url               ON jobs(url);
CREATE INDEX IF NOT EXISTS idx_jobs_company           ON jobs(company);
