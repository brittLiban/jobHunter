"""
dashboard/app.py - Streamlit UI for the Job Hunter system.

Run with: streamlit run dashboard/app.py
"""
import asyncio
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from database import db as db_ops
from resume_loader import load_resume_text
from submitter.service import auto_apply_job, resume_manual_auto_apply_job
from tracker.tracker import (
    clear_apply_block,
    log_apply_dry_run,
    log_apply_failure,
    log_apply_manual_action,
    log_apply_success,
    update_status,
)

# ── Page config ──────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="JobHunter",
    page_icon="J",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    [data-testid="stMetricValue"] { font-size: 1.5rem !important; }
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] {
        padding: 8px 16px;
        font-weight: 600;
    }
    div[data-testid="stExpander"] details summary p {
        font-weight: 600;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

db_ops.init_db()

# ── Session state defaults ───────────────────────────────────────────────────

if "selected_job_id" not in st.session_state:
    st.session_state.selected_job_id = None
if "scraper_running" not in st.session_state:
    st.session_state.scraper_running = False
if "scraper_log" not in st.session_state:
    st.session_state.scraper_log = ""
if "scraper_result" not in st.session_state:
    st.session_state.scraper_result = None

# ── Constants ────────────────────────────────────────────────────────────────

ALL_STATUSES = [
    "All", "found", "scored", "filtered",
    "awaiting_captcha", "awaiting_email_code", "awaiting_verification",
    "applied", "rejected", "interview", "offer", "skipped",
]
MANUAL_STATUSES = [
    "found", "scored", "awaiting_captcha", "awaiting_email_code",
    "awaiting_verification", "applied", "rejected", "interview",
    "offer", "skipped",
]
MANUAL_CHECKPOINT_STATUSES = {
    "awaiting_captcha", "awaiting_email_code", "awaiting_verification",
}

PAGES = {
    "Scraper": "Run the job discovery pipeline",
    "Jobs": "Browse and manage discovered jobs",
    "Profile": "Your profile and preferences",
    "Extension": "Browser extension setup",
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def score_color(score: int | None) -> str:
    if score is None:
        return "gray"
    if score >= 80:
        return "green"
    if score >= 60:
        return "orange"
    return "red"


def _load_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _unwrap_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result")
    return result if isinstance(result, dict) else payload


def _safe_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _safe_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _existing_path(raw: object) -> Path | None:
    candidate = str(raw or "").strip()
    if not candidate:
        return None
    path = Path(candidate)
    return path if path.exists() else None


def _is_manual_checkpoint_status(status: object) -> bool:
    return str(status or "").strip() in MANUAL_CHECKPOINT_STATUSES


# ── Sidebar ──────────────────────────────────────────────────────────────────

with st.sidebar:
    st.title("JobHunter")

    # Quick stats
    stats = db_ops.get_stats()
    c1, c2 = st.columns(2)
    c1.metric("Jobs", stats["total_jobs"])
    c2.metric("Priority", stats["total_priority"])

    st.divider()

    page = st.radio(
        "Navigate",
        list(PAGES.keys()),
        format_func=lambda p: p,
        label_visibility="collapsed",
    )

    st.divider()
    if st.button("Refresh", use_container_width=True):
        st.rerun()
    st.caption(f"Model: {config.OLLAMA_MODEL}")
    st.caption(f"DB: {config.DB_PATH}")


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: SCRAPER
# ═══════════════════════════════════════════════════════════════════════════════

def page_scraper():
    st.header("Scraper")
    st.caption("Discover, extract, score, and queue jobs from configured sources.")

    # ── Source summary ────────────────────────────────────────────────────
    with st.expander("Configured Sources", expanded=False):
        col1, col2, col3 = st.columns(3)
        with col1:
            st.markdown(f"**Greenhouse** ({len(config.GREENHOUSE_BOARD_NAMES)} boards)")
            st.caption(", ".join(config.GREENHOUSE_BOARD_NAMES[:15]) + ("..." if len(config.GREENHOUSE_BOARD_NAMES) > 15 else ""))
        with col2:
            st.markdown(f"**Ashby** ({len(config.ASHBY_BOARD_NAMES)} boards)")
            st.caption(", ".join(config.ASHBY_BOARD_NAMES[:10]) + ("..." if len(config.ASHBY_BOARD_NAMES) > 10 else ""))
        with col3:
            st.markdown(f"**Lever** ({len(config.LEVER_SITE_NAMES)} boards)")
            st.caption(", ".join(config.LEVER_SITE_NAMES))

        st.markdown(f"**Company Sites**: {len(config.COMPANY_SITE_TARGETS)} targets")

    # ── Location regions ──────────────────────────────────────────────────
    with st.expander("Location Regions", expanded=False):
        st.caption(
            "Controls which regions pass the location prefilter. "
            "Jobs matching any selected region are kept for scoring."
        )
        available_regions = ["us", "remote", "canada", "europe", "apac"]
        current_regions = [r.lower() for r in config.ALLOWED_LOCATION_REGIONS]

        selected_regions = st.multiselect(
            "Allowed regions",
            available_regions,
            default=[r for r in current_regions if r in available_regions],
            label_visibility="collapsed",
        )
        disable_filter = st.checkbox(
            "Disable location filtering entirely",
            value="*" in current_regions,
        )
        if disable_filter:
            st.info("All locations will pass through. The LLM will still score location fit.")

        if st.button("Save Region Settings"):
            new_regions = ["*"] if disable_filter else selected_regions
            _update_config_regions(new_regions)
            st.success("Saved! Restart the app or re-run the scraper for changes to take effect.")

    # ── Target roles ──────────────────────────────────────────────────────
    with st.expander("Target Roles & Filters", expanded=False):
        st.markdown("**Active resume variant**: " + str(config.ACTIVE_RESUME.get("label", config.ACTIVE_RESUME_KEY)))
        st.markdown("**Target roles**: " + ", ".join(config.TARGET_ROLES))
        st.markdown("**Excluded title keywords**: " + ", ".join(config.EXCLUDED_TITLE_KEYWORDS))

    st.divider()

    # ── Run controls ──────────────────────────────────────────────────────
    col_run, col_reset = st.columns([3, 1])

    with col_run:
        run_disabled = st.session_state.scraper_running
        if st.button(
            "Running..." if run_disabled else "Run Scraper",
            type="primary",
            use_container_width=True,
            disabled=run_disabled,
        ):
            st.session_state.scraper_running = True
            st.session_state.scraper_log = ""
            st.session_state.scraper_result = None
            st.rerun()

    with col_reset:
        if st.button("Clear Jobs", use_container_width=True):
            db_ops.reset_job_data()
            st.success("All jobs and applications cleared.")
            st.rerun()

    # ── Execute scraper ───────────────────────────────────────────────────
    if st.session_state.scraper_running:
        _run_scraper_with_progress()

    # ── Last run result ───────────────────────────────────────────────────
    if st.session_state.scraper_result:
        result = st.session_state.scraper_result
        if result.get("success"):
            st.success("Scraper completed successfully.")
        else:
            st.error(f"Scraper failed: {result.get('error', 'unknown error')}")

    if st.session_state.scraper_log:
        with st.expander("Scraper Output", expanded=False):
            st.code(st.session_state.scraper_log, language="log")


def _run_scraper_with_progress():
    """Run main.py as a subprocess and stream output."""
    project_root = Path(__file__).parent.parent
    main_py = str(project_root / "main.py")
    python_exe = sys.executable

    progress_placeholder = st.empty()
    log_placeholder = st.empty()
    status_placeholder = st.empty()

    progress_placeholder.info("Starting scraper pipeline...")

    try:
        process = subprocess.Popen(
            [python_exe, main_py],
            cwd=str(project_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        log_lines = []
        jobs_found = 0
        scored_count = 0
        current_phase = "Discovering jobs..."

        for line in iter(process.stdout.readline, ""):
            line = line.rstrip()
            log_lines.append(line)

            # Parse progress from log output
            if "Starting discovery" in line:
                current_phase = "Discovering jobs from ATS boards..."
            elif "title filter:" in line:
                current_phase = "Filtering by target roles..."
            elif "location prefilter:" in line:
                current_phase = "Filtering by location..."
            elif "New jobs inserted:" in line:
                try:
                    jobs_found = int(line.split("New jobs inserted:")[1].split("(")[0].strip())
                except (ValueError, IndexError):
                    pass
                current_phase = f"Found {jobs_found} matching jobs. Scoring with LLM..."
            elif "[Pipeline] Processing:" in line:
                try:
                    app_num = line.split("app=")[1].split(")")[0]
                    current_phase = f"Scoring job {app_num}..."
                except (IndexError, ValueError):
                    pass
            elif "PIPELINE SUMMARY" in line:
                current_phase = "Pipeline complete!"

            progress_placeholder.info(current_phase)
            # Show last 20 lines
            recent = "\n".join(log_lines[-20:])
            log_placeholder.code(recent, language="log")

        process.wait()
        full_log = "\n".join(log_lines)
        st.session_state.scraper_log = full_log

        if process.returncode == 0:
            st.session_state.scraper_result = {"success": True}
        else:
            st.session_state.scraper_result = {
                "success": False,
                "error": f"Process exited with code {process.returncode}",
            }

    except Exception as e:
        st.session_state.scraper_result = {"success": False, "error": str(e)}

    st.session_state.scraper_running = False
    st.rerun()


def _update_config_regions(regions: list[str]):
    """Write updated ALLOWED_LOCATION_REGIONS to config.py."""
    config_path = Path(__file__).parent.parent / "config.py"
    content = config_path.read_text(encoding="utf-8")

    import re
    pattern = r"ALLOWED_LOCATION_REGIONS:\s*list\[str\]\s*=\s*\[.*?\]"
    items = ", ".join(f'"{r}"' for r in regions)
    replacement = f"ALLOWED_LOCATION_REGIONS: list[str] = [{items}]"
    new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

    if new_content != content:
        config_path.write_text(new_content, encoding="utf-8")


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: JOBS
# ═══════════════════════════════════════════════════════════════════════════════

def page_jobs():
    st.header("Jobs")

    stats = db_ops.get_stats()

    # ── Metrics row ───────────────────────────────────────────────────────
    m1, m2, m3, m4, m5, m6 = st.columns(6)
    m1.metric("Total", stats["total_jobs"])
    m2.metric("Scored", stats["total_scored"])
    m3.metric("Priority (80+)", stats["total_priority"])
    m4.metric("Applied", stats["total_applied"])
    m5.metric("Filtered", stats["total_filtered"])
    m6.metric("Avg Score", stats["avg_score"])

    # ── Filters ───────────────────────────────────────────────────────────
    with st.expander("Filters", expanded=True):
        fc1, fc2, fc3, fc4, fc5 = st.columns([1, 1, 1, 1, 2])
        with fc1:
            status_filter = st.selectbox("Status", ALL_STATUSES, key="job_status")
        with fc2:
            score_range = st.slider("Score", 0, 100, (0, 100), step=5, key="job_score")
        with fc3:
            companies = ["All"] + db_ops.get_distinct_companies()
            company_filter = st.selectbox("Company", companies, key="job_company")
        with fc4:
            sources = ["All"] + db_ops.get_distinct_sources()
            source_filter = st.selectbox("Source", sources, key="job_source")
        with fc5:
            search_query = st.text_input("Search", placeholder="title, company, or source...", key="job_search")

    # ── Load and filter ───────────────────────────────────────────────────
    jobs = _load_jobs(status_filter, score_range, company_filter, source_filter, search_query)

    if not jobs:
        st.info("No jobs match your filters. Run the scraper to discover jobs.")
        return

    st.caption(f"Showing {len(jobs)} job(s)")

    # ── Jobs table ────────────────────────────────────────────────────────
    display_rows = []
    for job in jobs:
        score = job.get("fit_score")
        display_rows.append({
            "Score": score if score is not None else "",
            "Title": job.get("title", ""),
            "Company": job.get("company", ""),
            "Location": job.get("location", ""),
            "Source": job.get("source", ""),
            "Status": job.get("status") or "found",
            "Apply": "Yes" if job.get("apply_decision") else ("No" if score is not None else "-"),
            "Posting": job.get("url", ""),
        })

    df = pd.DataFrame(display_rows)
    event = st.dataframe(
        df,
        use_container_width=True,
        hide_index=True,
        on_select="rerun",
        selection_mode="single-row",
        column_config={
            "Posting": st.column_config.LinkColumn("Posting", display_text="Open"),
            "Score": st.column_config.NumberColumn("Score", format="%d"),
        },
    )

    # ── Selection handling ────────────────────────────────────────────────
    selected_rows = event.selection.rows
    if selected_rows:
        selected_job = jobs[selected_rows[0]]
        st.session_state.selected_job_id = selected_job.get("job_id")

    if st.session_state.selected_job_id is not None:
        active_job = next(
            (j for j in jobs if j.get("job_id") == st.session_state.selected_job_id),
            None,
        )
        if active_job:
            st.divider()
            _render_job_detail(active_job)


def _load_jobs(status_filter, score_range, company_filter, source_filter, search):
    rows = db_ops.get_all_jobs_with_applications()
    jobs = [dict(row) for row in rows]

    if status_filter != "All":
        jobs = [j for j in jobs if j.get("status") == status_filter]

    if score_range != (0, 100):
        lo, hi = score_range
        jobs = [j for j in jobs if j.get("fit_score") is not None and lo <= j["fit_score"] <= hi]

    if company_filter != "All":
        jobs = [j for j in jobs if j.get("company") == company_filter]

    if source_filter != "All":
        jobs = [j for j in jobs if j.get("source") == source_filter]

    if search.strip():
        needle = search.strip().lower()
        jobs = [
            j for j in jobs
            if needle in (j.get("title") or "").lower()
            or needle in (j.get("company") or "").lower()
            or needle in (j.get("source") or "").lower()
        ]

    return jobs


def _render_job_detail(job: dict) -> None:
    app_id = job.get("app_id")
    score = job.get("fit_score")
    title = job.get("title", "Untitled")
    company = job.get("company", "")
    status = job.get("status") or "found"

    # ── Header ────────────────────────────────────────────────────────
    hcol, scol = st.columns([4, 1])
    with hcol:
        priority = " [PRIORITY]" if score is not None and score >= 80 else ""
        st.subheader(f"{title} @ {company}{priority}")
        date_str = (job.get("date_found") or "")[:10]
        st.caption(
            f"Location: {job.get('location') or '-'} | "
            f"Source: {job.get('source') or '-'} | "
            f"Status: {status} | Found: {date_str}"
        )
        if job.get("url"):
            st.markdown(f"[View Posting]({job['url']})")
    with scol:
        if score is not None:
            st.metric("Fit Score", f"{score}/100")

    # ── Data payloads ─────────────────────────────────────────────────
    extracted_payload = _load_json(job.get("extracted_data"))
    scorer_payload = _load_json(job.get("scorer_data"))
    tailor_payload = _load_json(job.get("tailor_data"))
    apply_payload = _load_json(job.get("apply_data"))

    extracted_result = _unwrap_result(extracted_payload) if extracted_payload else {}
    scorer_result = _unwrap_result(scorer_payload) if scorer_payload else {}
    tailor_resume_result = _unwrap_result(tailor_payload.get("resume", {}))
    tailor_answers_result = _unwrap_result(tailor_payload.get("answers", {}))

    # ── Tabs ──────────────────────────────────────────────────────────
    tabs = st.tabs(["Overview", "Description", "Tailored Materials", "Actions"])

    # --- Overview ---
    with tabs[0]:
        if scorer_result:
            summary = scorer_result.get("one_line_summary", "")
            if summary:
                st.info(f"**AI Summary**: {summary}")

            mc, gc = st.columns(2)
            with mc:
                st.markdown("**Match Reasons**")
                for r in scorer_result.get("match_reasons", []):
                    st.markdown(f"- {r}")
            with gc:
                st.markdown("**Gap Reasons**")
                for r in scorer_result.get("gap_reasons", []):
                    st.markdown(f"- {r}")
        else:
            st.caption("Not scored yet. Run the scraper to score this job.")

        if extracted_result:
            with st.expander("Extracted Metadata"):
                st.json(extracted_result)

    # --- Description ---
    with tabs[1]:
        desc = job.get("description") or "No description available."
        st.text_area("desc", desc, height=420, disabled=True, label_visibility="collapsed")

    # --- Tailored Materials ---
    with tabs[2]:
        tailored_summary = job.get("tailored_summary")
        cover_letter = job.get("cover_letter")

        if not tailored_summary and not cover_letter:
            if score is not None and score >= 80:
                st.warning("Tailored materials not generated. Re-run the scraper.")
            else:
                st.info("Tailored materials are generated only for jobs scoring 80+.")
        else:
            if tailored_summary:
                st.markdown("**Suggested Summary**")
                st.write(tailored_summary)
                st.divider()

            bullets = tailor_resume_result.get("tailored_bullets", [])
            if bullets:
                st.markdown("**Tailored Resume Bullets**")
                for b in bullets:
                    st.markdown(f"- {b}")

            if tailor_answers_result:
                st.divider()
                wr, wh = st.columns(2)
                with wr:
                    st.markdown("**Why This Role**")
                    st.write(tailor_answers_result.get("why_role", ""))
                with wh:
                    st.markdown("**Why Hire Me**")
                    st.write(tailor_answers_result.get("why_hire", ""))

            if cover_letter:
                st.divider()
                st.markdown("**Cover Letter**")
                st.text_area("cl", cover_letter, height=320, disabled=True, label_visibility="collapsed")

        if tailor_payload:
            with st.expander("Tailor Logs"):
                st.json(tailor_payload)

    # --- Actions ---
    with tabs[3]:
        if app_id is None:
            st.info("No application row yet. Run the scraper first.")
            return

        blocked_reason = str(apply_payload.get("blocked_reason") or "").strip()
        missing_fields = _safe_str_list(apply_payload.get("missing_profile_fields"))
        unknown_fields = _safe_str_list(apply_payload.get("unknown_required_fields"))
        checkpoint_artifacts = _safe_dict(apply_payload.get("checkpoint_artifacts"))
        manual_required = bool(apply_payload.get("manual_action_required")) or _is_manual_checkpoint_status(status)

        if apply_payload and manual_required:
            st.warning(
                f"**Manual action required**: "
                f"{apply_payload.get('error') or blocked_reason or 'checkpoint detected'}"
            )
            next_step = str(apply_payload.get("next_step") or "").strip()
            if next_step:
                st.caption(next_step)

            checkpoint_url = str(
                apply_payload.get("checkpoint_url") or apply_payload.get("apply_url") or ""
            ).strip()
            links = []
            if checkpoint_url:
                links.append(f"[Open Checkpoint]({checkpoint_url})")
            if job.get("url"):
                links.append(f"[View Posting]({job['url']})")
            if links:
                st.markdown(" | ".join(links))

            screenshot_path = _existing_path(checkpoint_artifacts.get("screenshot_path"))
            if screenshot_path is not None:
                st.image(str(screenshot_path), caption="Blocked page screenshot", use_container_width=True)

        elif apply_payload and blocked_reason:
            st.warning(f"**Auto-apply blocked**: {apply_payload.get('error') or blocked_reason}")
            if missing_fields:
                st.caption("Missing fields: " + ", ".join(sorted(missing_fields)))
            if unknown_fields:
                st.caption(f"Unresolved questions: {len(unknown_fields)}")

        # Action buttons
        b1, b2, b3 = st.columns(3)
        with b1:
            if st.button("Mark Applied", type="primary", use_container_width=True, key=f"apply_{app_id}"):
                update_status(app_id, "applied")
                st.success("Done.")
                st.rerun()
        with b2:
            label = "Retry Auto Apply" if blocked_reason or manual_required else "Auto Apply"
            if st.button(label, use_container_width=True, key=f"auto_{app_id}"):
                profile = db_ops.get_user_profile()
                if profile is None:
                    st.error("No profile found.")
                else:
                    with st.spinner("Submitting..."):
                        result = asyncio.run(auto_apply_job(job, profile, dry_run=config.AUTO_APPLY_DRY_RUN))
                    payload = result.model_dump()
                    if result.success and result.submitted:
                        note = "Auto-submitted."
                        if result.confirmation_text:
                            note += f" Confirmation: {result.confirmation_text}"
                        log_apply_success(app_id, payload, notes=note)
                        st.success("Application submitted.")
                    elif result.success and result.dry_run:
                        log_apply_dry_run(app_id, payload)
                        st.success("Dry run completed.")
                    elif result.manual_action_required:
                        log_apply_manual_action(app_id, result.error or "manual_action_required", payload)
                        st.warning(result.error or "Manual action required.")
                    else:
                        log_apply_failure(app_id, result.error or "auto_apply_failed", payload)
                        st.error(result.error or "Auto-apply failed.")
                    st.rerun()
        with b3:
            if st.button(
                "Open Manual Session",
                use_container_width=True,
                key=f"manual_{app_id}",
                disabled=not manual_required,
            ):
                with st.spinner("Opening browser..."):
                    result = asyncio.run(resume_manual_auto_apply_job(job))
                payload = result.model_dump()
                if result.success and result.submitted:
                    note = "Submitted after manual checkpoint."
                    if result.confirmation_text:
                        note += f" Confirmation: {result.confirmation_text}"
                    log_apply_success(app_id, payload, notes=note)
                    st.success("Submitted.")
                elif result.manual_action_required:
                    log_apply_manual_action(app_id, result.error or "manual_action_required", payload)
                    st.warning(result.error or "Manual action still required.")
                else:
                    log_apply_failure(app_id, result.error or "manual_failed", payload)
                    st.error(result.error or "Manual session failed.")
                st.rerun()

        b4, b5, b6 = st.columns(3)
        with b4:
            if st.button(
                "Clear Block", use_container_width=True, key=f"clear_{app_id}",
                disabled=not (blocked_reason or manual_required or _is_manual_checkpoint_status(status)),
            ):
                clear_apply_block(app_id, notes="Block cleared. Ready to retry.")
                st.success("Block cleared.")
                st.rerun()
        with b5:
            if st.button("Skip", use_container_width=True, key=f"skip_{app_id}"):
                update_status(app_id, "skipped")
                st.rerun()
        with b6:
            if st.button("Reject", use_container_width=True, key=f"reject_{app_id}"):
                update_status(app_id, "rejected")
                st.rerun()

        st.divider()
        st.markdown("**Manual Override**")

        oc1, oc2 = st.columns([1, 2])
        with oc1:
            safe_status = status if status in MANUAL_STATUSES else MANUAL_STATUSES[0]
            new_status = st.selectbox("Status", MANUAL_STATUSES, index=MANUAL_STATUSES.index(safe_status), key=f"st_{app_id}")
        with oc2:
            notes_val = st.text_area("Notes", value=job.get("notes") or "", key=f"notes_{app_id}", height=80)

        fc1, fc2 = st.columns(2)
        with fc1:
            follow_up = st.date_input("Follow-up", value=None, key=f"fu_{app_id}")
        with fc2:
            st.markdown("&nbsp;", unsafe_allow_html=True)
            if st.button("Save", use_container_width=True, key=f"save_{app_id}"):
                update_status(app_id, new_status, notes=notes_val, follow_up_date=str(follow_up) if follow_up else None)
                st.success("Saved.")
                st.rerun()

        if apply_payload:
            with st.expander("Apply Logs"):
                st.json(apply_payload)


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: PROFILE
# ═══════════════════════════════════════════════════════════════════════════════

def page_profile():
    st.header("Profile")

    profile = db_ops.get_user_profile()
    if profile is None:
        st.error("No profile found. Run the scraper first to seed your profile.")
        return

    preferences = profile.get("preferences_json", {})
    application_defaults = preferences.get("application_form_defaults", {})
    current_variant_key = preferences.get("resume_variant_key", config.ACTIVE_RESUME_KEY)
    variant_keys = list(config.RESUME_VARIANTS.keys())
    default_idx = variant_keys.index(current_variant_key) if current_variant_key in variant_keys else 0

    # ── Resume variant ────────────────────────────────────────────────
    with st.expander("Resume Variant", expanded=True):
        selected_key = st.selectbox(
            "Active Variant",
            options=variant_keys,
            index=default_idx,
            format_func=lambda k: str(config.RESUME_VARIANTS[k]["label"]),
        )
        variant = config.RESUME_VARIANTS[selected_key]
        st.caption(f"Resume: {variant['path']}")
        st.caption(f"Target roles: {', '.join(variant['target_roles'])}")

        if st.button("Load Into Profile", use_container_width=True):
            try:
                resume_text_src = str(variant.get("profile_text_path") or variant["path"])
                loaded_text = load_resume_text(resume_text_src)
                updated_prefs = dict(preferences)
                updated_prefs["resume_variant_key"] = selected_key
                updated_prefs["resume_variant_label"] = variant["label"]
                updated_prefs["resume_source_path"] = str(variant["path"])
                updated_prefs["resume_text_source_path"] = resume_text_src
                updated_prefs["target_roles"] = list(variant["target_roles"])
                db_ops.update_user_profile(resume_text=loaded_text, preferences_json=json.dumps(updated_prefs))
                st.success("Loaded.")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {e}")

    # ── Application defaults ──────────────────────────────────────────
    if application_defaults:
        with st.expander("Application Defaults"):
            c1, c2 = st.columns(2)
            with c1:
                st.write(f"**Email**: {application_defaults.get('email', '')}")
                st.write(f"**Phone**: {application_defaults.get('phone', '')}")
                st.write(f"**Work Auth (US)**: {application_defaults.get('work_authorization_us', '')}")
                st.write(f"**Employer**: {application_defaults.get('current_or_previous_employer', '')}")
            with c2:
                st.write(f"**Gender**: {application_defaults.get('gender', '')}")
                st.write(f"**Veteran**: {application_defaults.get('veteran_status', '')}")
                st.write(f"**School**: {application_defaults.get('school_name', '')}")
                st.write(f"**Degree**: {application_defaults.get('degree', '')}")

    # ── Autonomy readiness ────────────────────────────────────────────
    all_jobs = [dict(row) for row in db_ops.get_all_jobs_with_applications()]
    insights = _collect_auto_apply_insights(all_jobs)

    with st.expander("Auto-Apply Readiness", expanded=True):
        rc1, rc2, rc3, rc4 = st.columns(4)
        rc1.metric("Ready", len(insights["ready_jobs"]))
        rc2.metric("Blocked", len(insights["blocked_jobs"]))
        rc3.metric("Missing Fields", len(insights["missing_fields"]))
        rc4.metric("Open Questions", len(insights["unresolved_questions"]))

        if insights["ready_jobs"]:
            st.markdown("**Ready for auto-apply:**")
            for j in insights["ready_jobs"][:10]:
                url = str(j.get("url") or "").strip()
                line = f"- {j.get('company', '')} | {j.get('title', '')} | score {j.get('fit_score', '-')}"
                if url:
                    line += f" | [posting]({url})"
                st.markdown(line)

        if insights["blocked_jobs"]:
            st.markdown("**Blocked:**")
            for item in insights["blocked_jobs"][:5]:
                st.markdown(f"- {item.get('job', '')} | {item.get('reason', '')}")

        if insights["unresolved_questions"]:
            st.markdown("**Unresolved questions:**")
            for q in list(insights["unresolved_questions"].keys())[:5]:
                st.markdown(f"- {q}")

    # ── Edit profile ──────────────────────────────────────────────────
    with st.expander("Edit Profile"):
        with st.form("profile_form"):
            c1, c2 = st.columns(2)
            with c1:
                name = st.text_input("Name", value=profile.get("name") or "")
                email = st.text_input("Email", value=profile.get("email") or "")
            with c2:
                phone = st.text_input("Phone", value=profile.get("phone") or "")

            resume_text = st.text_area(
                "Resume Text (plain text for LLM)",
                value=profile.get("resume_text") or "",
                height=300,
            )
            prefs_raw = st.text_area(
                "Preferences JSON",
                value=json.dumps(preferences, indent=2),
                height=200,
            )

            if st.form_submit_button("Save Profile", type="primary"):
                try:
                    parsed = json.loads(prefs_raw)
                    db_ops.update_user_profile(
                        name=name, email=email, phone=phone,
                        resume_text=resume_text, preferences_json=json.dumps(parsed),
                    )
                    st.success("Profile saved.")
                except json.JSONDecodeError as e:
                    st.error(f"Invalid JSON: {e}")

    # System info
    st.divider()
    st.caption(
        f"Auto-apply: {'enabled' if config.AUTO_APPLY_ENABLED else 'disabled'} | "
        f"Dry run: {config.AUTO_APPLY_DRY_RUN} | "
        f"Scheduler: every {config.SCHEDULER_INTERVAL_HOURS}h"
    )


def _collect_auto_apply_insights(jobs):
    ready_jobs = db_ops.get_auto_apply_jobs()
    blocked_jobs = []
    missing_fields = {}
    unresolved_questions = {}
    unsupported_jobs = []

    for job in jobs:
        if (job.get("status") or "") != "scored":
            continue
        if not job.get("apply_decision"):
            continue
        score = job.get("fit_score")
        if score is None or score < config.AUTO_APPLY_MIN_SCORE:
            continue

        payload = _load_json(job.get("apply_data"))
        blocked_reason = str(payload.get("blocked_reason") or "").strip()
        if not blocked_reason:
            continue

        label = f"{job.get('company', '')} - {job.get('title', '')}".strip(" -")
        blocked_jobs.append({
            "job": label,
            "reason": blocked_reason,
            "error": payload.get("error") or "",
            "posting_url": job.get("url") or "",
        })

        if blocked_reason == "unsupported_source":
            unsupported_jobs.append(label)

        for field_name in _safe_str_list(payload.get("missing_profile_fields")):
            missing_fields.setdefault(field_name, []).append(label)

        if blocked_reason == "unknown_required_fields":
            for q in _safe_str_list(payload.get("unknown_required_fields")):
                unresolved_questions.setdefault(q, []).append(label)

    return {
        "ready_jobs": [dict(row) for row in ready_jobs],
        "blocked_jobs": blocked_jobs,
        "missing_fields": missing_fields,
        "unresolved_questions": unresolved_questions,
        "unsupported_jobs": unsupported_jobs,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: EXTENSION
# ═══════════════════════════════════════════════════════════════════════════════

def page_extension():
    st.header("Browser Extension")
    st.caption("Set up the Chrome/Edge extension to autofill job applications.")

    # ── Setup guide ───────────────────────────────────────────────────
    with st.expander("Setup Guide", expanded=True):
        st.markdown("""
**1. Install the extension**
- Open Chrome/Edge and go to `chrome://extensions`
- Enable "Developer mode" (top right toggle)
- Click "Load unpacked" and select the folder:
  `apps/extension/chrome/`

**2. Start the web server**
- The extension needs the Next.js API server running
- Run: `cd apps/web && npm run dev`
- This starts the API at `http://localhost:3000`

**3. Configure the extension**
- Click the JobHunter extension icon in your browser toolbar
- Set **API URL** to `http://localhost:3000`
- Set **Token** (generate one from the Extension Tokens section below)
- Click **Test** to verify connection

**4. Using autofill**
- Navigate to a job application page (Greenhouse, Lever, etc.)
- Click the extension icon and hit **Autofill**
- The extension will fill form fields, upload your resume, and optionally submit
        """)

    # ── Extension location ────────────────────────────────────────────
    ext_path = Path(__file__).parent.parent / "apps" / "extension" / "chrome"
    st.markdown(f"**Extension folder**: `{ext_path}`")

    if ext_path.exists():
        st.success("Extension files found.")
        manifest = ext_path / "manifest.json"
        if manifest.exists():
            mdata = json.loads(manifest.read_text(encoding="utf-8"))
            st.caption(f"Version: {mdata.get('version', '?')} | Name: {mdata.get('name', '?')}")
    else:
        st.warning("Extension folder not found at expected path.")

    # ── API server check ──────────────────────────────────────────────
    st.divider()
    st.subheader("API Server Status")

    import urllib.request
    try:
        req = urllib.request.urlopen("http://localhost:3000/api/health", timeout=3)
        st.success("Next.js API server is running at http://localhost:3000")
    except Exception:
        st.warning(
            "API server not reachable at http://localhost:3000. "
            "Start it with: `cd apps/web && npm run dev`"
        )

    # ── Supported ATS ─────────────────────────────────────────────────
    st.divider()
    st.subheader("Supported Application Forms")
    st.markdown("""
The extension can autofill forms on these platforms:
- **Greenhouse** (embedded job_app iframes) - full support including resume upload
- **Lever** - form field filling
- **Ashby** - form field filling
- **Workday** - basic field filling
- **Generic** - attempts to fill standard HTML forms on any page

The extension uses smart field detection with shadow DOM traversal, so it works even with complex React-based forms.
    """)

    # ── Tips ──────────────────────────────────────────────────────────
    st.divider()
    st.subheader("Tips")
    st.markdown("""
- **Auto-detection**: If the URL contains `?jhApplicationId=...`, the extension auto-fills on page load
- **Refresh materials**: Toggle this on to re-generate tailored answers before filling
- **Auto-submit**: Only enable this when you're confident the form is filled correctly
- **Unresolved fields**: After autofill, check the extension popup for fields it couldn't fill
    """)


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTER
# ═══════════════════════════════════════════════════════════════════════════════

if page == "Scraper":
    page_scraper()
elif page == "Jobs":
    page_jobs()
elif page == "Profile":
    page_profile()
elif page == "Extension":
    page_extension()
