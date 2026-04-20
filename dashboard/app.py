"""
dashboard/app.py — Streamlit UI for the Job Hunter system.

Run with:  streamlit run dashboard/app.py
"""
import json
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

# Ensure project root is on the path when running via `streamlit run`
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.db import (
    get_all_jobs_with_applications,
    get_distinct_companies,
    get_stats,
    get_user_profile,
    init_db,
    update_application,
    update_user_profile,
)
from tracker.tracker import update_status

# ── Page config ───────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Job Hunter",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    [data-testid="stMetricValue"] { font-size: 1.6rem !important; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Init ──────────────────────────────────────────────────────────────────────

init_db()

if "selected_app_id" not in st.session_state:
    st.session_state.selected_app_id = None

# ── Constants ─────────────────────────────────────────────────────────────────

ALL_STATUSES = [
    "All", "found", "scored", "filtered",
    "applied", "rejected", "interview", "offer", "skipped",
]
MANUAL_STATUSES = ["found", "scored", "applied", "rejected", "interview", "offer", "skipped"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def score_icon(score) -> str:
    if score is None:
        return "⚪"
    if score >= 80:
        return "🟢"
    if score >= 60:
        return "🟡"
    return "🔴"


def load_jobs(
    status_filter: str,
    min_score: int,
    company_filter: str,
    search: str,
) -> list[dict]:
    rows = get_all_jobs_with_applications()
    jobs = [dict(r) for r in rows]

    if status_filter != "All":
        jobs = [j for j in jobs if j.get("status") == status_filter]
    if min_score > 0:
        jobs = [j for j in jobs if (j.get("fit_score") or 0) >= min_score]
    if company_filter != "All":
        jobs = [j for j in jobs if j.get("company") == company_filter]
    if search.strip():
        q = search.strip().lower()
        jobs = [
            j for j in jobs
            if q in (j.get("title") or "").lower()
            or q in (j.get("company") or "").lower()
        ]
    return jobs


# ── Job detail renderer ───────────────────────────────────────────────────────

def render_job_detail(job: dict) -> None:
    """Full detail panel for a selected job row."""
    app_id  = job["app_id"]
    score   = job.get("fit_score")
    title   = job.get("title", "Untitled")
    company = job.get("company", "")
    status  = job.get("status", "found")

    col_h, col_s = st.columns([4, 1])
    with col_h:
        priority_tag = "  🌟 PRIORITY" if score and score >= 80 else ""
        st.subheader(f"{title} @ {company}{priority_tag}")
        date_str = (job.get("date_found") or "")[:10]
        st.caption(
            f"Location: {job.get('location') or '—'}  |  "
            f"Status: **{status}**  |  Found: {date_str}"
        )
        if job.get("url"):
            st.markdown(f"[View Job Posting ↗]({job['url']})")
    with col_s:
        if score is not None:
            st.metric("Fit Score", f"{score}/100")

    tabs = st.tabs(["Overview", "Job Description", "Tailored Materials", "Actions"])

    # ── Tab: Overview ─────────────────────────────────────────────────────────
    with tabs[0]:
        scorer_raw = job.get("scorer_data")
        if scorer_raw:
            sdata = json.loads(scorer_raw)
            summary = sdata.get("one_line_summary", "")
            if summary:
                st.info(f"**AI Summary:** {summary}")
            col_m, col_g = st.columns(2)
            with col_m:
                st.markdown("**Match Reasons**")
                for r in sdata.get("match_reasons", []):
                    st.markdown(f"- {r}")
            with col_g:
                st.markdown("**Gaps**")
                for r in sdata.get("gap_reasons", []):
                    st.markdown(f"- {r}")
        else:
            st.write("No scoring data yet — run `python main.py` to score jobs.")

        extracted_raw = job.get("extracted_data")
        if extracted_raw:
            with st.expander("Extracted Metadata"):
                st.json(json.loads(extracted_raw))

    # ── Tab: Job Description ──────────────────────────────────────────────────
    with tabs[1]:
        desc = job.get("description") or "No description available."
        st.text_area(
            "description",
            desc,
            height=420,
            disabled=True,
            label_visibility="collapsed",
        )

    # ── Tab: Tailored Materials ───────────────────────────────────────────────
    with tabs[2]:
        tailored_summary = job.get("tailored_summary")
        cover_letter     = job.get("cover_letter")
        tailor_raw       = job.get("tailor_data")

        if not tailored_summary and not cover_letter:
            if score and score >= 80:
                st.warning(
                    "Tailored materials were not generated (LLM may have failed). "
                    "Re-run `python main.py`."
                )
            else:
                st.info("Tailored materials are only generated for jobs scoring **80+**.")
        else:
            if tailored_summary:
                st.markdown("**Suggested Summary**")
                st.write(tailored_summary)
                st.divider()

            if tailor_raw:
                tdata = json.loads(tailor_raw)
                bullets = tdata.get("resume", {}).get("tailored_bullets", [])
                if bullets:
                    st.markdown("**Tailored Resume Bullets**")
                    for b in bullets:
                        if b:
                            st.markdown(f"- {b}")

                answers = tdata.get("answers", {})
                if answers:
                    st.divider()
                    col_a, col_b = st.columns(2)
                    with col_a:
                        st.markdown("**Why this role?**")
                        st.write(answers.get("why_role", ""))
                    with col_b:
                        st.markdown("**Why hire me?**")
                        st.write(answers.get("why_hire", ""))

            if cover_letter:
                st.divider()
                st.markdown("**Cover Letter**")
                st.text_area(
                    "cover_letter",
                    cover_letter,
                    height=320,
                    disabled=True,
                    label_visibility="collapsed",
                )
                st.download_button(
                    "⬇ Download Cover Letter",
                    data=cover_letter,
                    file_name=f"cover_letter_{company}.txt",
                    mime="text/plain",
                    key=f"dl_{app_id}",
                )

    # ── Tab: Actions ──────────────────────────────────────────────────────────
    with tabs[3]:
        col_a, col_b, col_c = st.columns(3)
        with col_a:
            if st.button(
                "Mark as Applied", type="primary",
                use_container_width=True, key=f"apply_{app_id}"
            ):
                update_status(app_id, "applied")
                st.success("Marked as applied!")
                st.rerun()
        with col_b:
            if st.button("Skip Job", use_container_width=True, key=f"skip_{app_id}"):
                update_status(app_id, "skipped")
                st.warning("Job skipped.")
                st.rerun()
        with col_c:
            if st.button("Mark Rejected", use_container_width=True, key=f"reject_{app_id}"):
                update_status(app_id, "rejected")
                st.error("Marked as rejected.")
                st.rerun()

        st.divider()
        st.markdown("**Manual Override**")
        col_s, col_n = st.columns([1, 2])
        with col_s:
            safe_status = status if status in MANUAL_STATUSES else MANUAL_STATUSES[0]
            new_status = st.selectbox(
                "Status",
                MANUAL_STATUSES,
                index=MANUAL_STATUSES.index(safe_status),
                key=f"status_sel_{app_id}",
            )
        with col_n:
            notes_val = st.text_area(
                "Notes",
                value=job.get("notes") or "",
                key=f"notes_{app_id}",
                height=80,
            )

        col_f, col_save = st.columns(2)
        with col_f:
            follow_up = st.date_input("Follow-up Date", value=None, key=f"follow_{app_id}")
        with col_save:
            st.markdown("&nbsp;", unsafe_allow_html=True)
            if st.button("Save Changes", use_container_width=True, key=f"save_{app_id}"):
                kw: dict = {"status": new_status, "notes": notes_val}
                if follow_up:
                    kw["follow_up_date"] = str(follow_up)
                update_application(app_id, **kw)
                st.success("Saved!")
                st.rerun()


# ═══════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ═══════════════════════════════════════════════════════════════════════════════

with st.sidebar:
    st.title("🎯 Job Hunter")
    st.caption("AI-powered job pipeline")
    st.divider()

    page = st.radio(
        "Navigation",
        ["Dashboard", "Profile Settings"],
        label_visibility="collapsed",
    )

    st.divider()
    st.subheader("Filters")
    status_filter  = st.selectbox("Status", ALL_STATUSES)
    min_score_filt = st.slider("Min Score", 0, 100, 0, step=5)
    companies      = ["All"] + get_distinct_companies()
    company_filter = st.selectbox("Company", companies)
    search_query   = st.text_input("Search", placeholder="title or company…")

    st.divider()
    if st.button("Refresh Data", use_container_width=True):
        st.rerun()
    st.caption("Run `python main.py` to scrape new jobs.")


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: Dashboard
# ═══════════════════════════════════════════════════════════════════════════════

if page == "Dashboard":

    # Stats row
    stats = get_stats()
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Total Jobs",     stats["total_jobs"])
    c2.metric("Scored",         stats["total_scored"])
    c3.metric("Priority (80+)", stats["total_priority"])
    c4.metric("Applied",        stats["total_applied"])
    c5.metric("Filtered Out",   stats["total_filtered"])
    c6.metric("Avg Score",      stats["avg_score"])

    st.divider()

    jobs = load_jobs(status_filter, min_score_filt, company_filter, search_query)

    if not jobs:
        st.info(
            "No jobs match your filters. "
            "Run `python main.py` to scrape and score jobs."
        )
    else:
        st.subheader(f"Jobs ({len(jobs)})")

        display_rows = []
        for j in jobs:
            sc = j.get("fit_score")
            display_rows.append({
                "":        score_icon(sc),
                "Title":   j.get("title", ""),
                "Company": j.get("company", ""),
                "Location":j.get("location", ""),
                "Score":   sc if sc is not None else "—",
                "Status":  j.get("status", ""),
                "Apply?":  "Yes" if j.get("apply_decision") else (
                    "No" if j.get("fit_score") is not None else "—"
                ),
                "Notes":   (j.get("notes") or "")[:60],
            })

        df = pd.DataFrame(display_rows)
        event = st.dataframe(
            df,
            use_container_width=True,
            hide_index=True,
            on_select="rerun",
            selection_mode="single-row",
        )

        selected_rows = event.selection.rows
        if selected_rows:
            sel_job = jobs[selected_rows[0]]
            st.session_state.selected_app_id = sel_job.get("app_id")

        # Detail panel below the table
        if st.session_state.selected_app_id:
            active_job = next(
                (j for j in jobs if j.get("app_id") == st.session_state.selected_app_id),
                None,
            )
            if active_job:
                st.divider()
                render_job_detail(active_job)

# ═══════════════════════════════════════════════════════════════════════════════
# PAGE: Profile Settings
# ═══════════════════════════════════════════════════════════════════════════════

elif page == "Profile Settings":
    st.title("Profile Settings")
    profile = get_user_profile()

    if profile is None:
        st.error("No profile found. Run `python main.py` first to seed the profile.")
    else:
        with st.form("profile_form"):
            col1, col2 = st.columns(2)
            with col1:
                name  = st.text_input("Name",  value=profile.get("name") or "")
                email = st.text_input("Email", value=profile.get("email") or "")
            with col2:
                phone = st.text_input("Phone", value=profile.get("phone") or "")

            resume_text = st.text_area(
                "Resume Text (plain text — used in all LLM prompts)",
                value=profile.get("resume_text") or "",
                height=400,
            )

            prefs = profile.get("preferences_json", {})
            prefs_raw = st.text_area(
                "Preferences JSON",
                value=json.dumps(prefs, indent=2),
                height=220,
            )

            submitted = st.form_submit_button("Save Profile", type="primary")
            if submitted:
                try:
                    prefs_parsed = json.loads(prefs_raw)
                    update_user_profile(
                        name=name,
                        email=email,
                        phone=phone,
                        resume_text=resume_text,
                        preferences_json=json.dumps(prefs_parsed),
                    )
                    st.success("Profile saved successfully!")
                except json.JSONDecodeError as exc:
                    st.error(f"Invalid JSON in preferences: {exc}")
