"""
dashboard/app.py - Streamlit UI for the Job Hunter system.

Run with: streamlit run dashboard/app.py
"""
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from database.db import (
    get_all_jobs_with_applications,
    get_distinct_companies,
    get_distinct_sources,
    get_stats,
    get_user_profile,
    init_db,
    update_user_profile,
)
from resume_loader import load_resume_text
from submitter.service import auto_apply_job
from tracker.tracker import (
    log_apply_dry_run,
    log_apply_failure,
    log_apply_success,
    update_status,
)

st.set_page_config(
    page_title="Job Hunter",
    page_icon="J",
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

init_db()

if "selected_job_id" not in st.session_state:
    st.session_state.selected_job_id = None

ALL_STATUSES = [
    "All",
    "found",
    "scored",
    "filtered",
    "applied",
    "rejected",
    "interview",
    "offer",
    "skipped",
]
MANUAL_STATUSES = [
    "found",
    "scored",
    "applied",
    "rejected",
    "interview",
    "offer",
    "skipped",
]


def score_icon(score: int | None) -> str:
    if score is None:
        return "New"
    if score >= 80:
        return "High"
    if score >= 60:
        return "Mid"
    return "Low"


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
    if isinstance(result, dict):
        return result
    return payload


def load_jobs(
    status_filter: str,
    score_range: tuple[int, int],
    company_filter: str,
    source_filter: str,
    search: str,
) -> list[dict]:
    rows = get_all_jobs_with_applications()
    jobs = [dict(row) for row in rows]

    if status_filter != "All":
        jobs = [job for job in jobs if job.get("status") == status_filter]

    if score_range != (0, 100):
        min_score, max_score = score_range
        jobs = [
            job
            for job in jobs
            if job.get("fit_score") is not None
            and min_score <= job["fit_score"] <= max_score
        ]

    if company_filter != "All":
        jobs = [job for job in jobs if job.get("company") == company_filter]

    if source_filter != "All":
        jobs = [job for job in jobs if job.get("source") == source_filter]

    if search.strip():
        needle = search.strip().lower()
        jobs = [
            job
            for job in jobs
            if needle in (job.get("title") or "").lower()
            or needle in (job.get("company") or "").lower()
            or needle in (job.get("source") or "").lower()
        ]

    return jobs


def render_job_detail(job: dict) -> None:
    """Render the full detail panel for a selected job."""
    app_id = job.get("app_id")
    score = job.get("fit_score")
    title = job.get("title", "Untitled")
    company = job.get("company", "")
    status = job.get("status") or "found"

    header_col, score_col = st.columns([4, 1])
    with header_col:
        priority_tag = " [PRIORITY]" if score is not None and score >= 80 else ""
        st.subheader(f"{title} @ {company}{priority_tag}")
        date_str = (job.get("date_found") or "")[:10]
        st.caption(
            f"Location: {job.get('location') or '-'} | "
            f"Source: {job.get('source') or '-'} | "
            f"Status: {status} | Found: {date_str}"
        )
        if job.get("url"):
            st.markdown(f"[View Job Posting]({job['url']})")
    with score_col:
        if score is not None:
            st.metric("Fit Score", f"{score}/100")

    extracted_payload = _load_json(job.get("extracted_data"))
    scorer_payload = _load_json(job.get("scorer_data"))
    tailor_payload = _load_json(job.get("tailor_data"))
    apply_payload = _load_json(job.get("apply_data"))

    extracted_result = _unwrap_result(extracted_payload) if extracted_payload else {}
    scorer_result = _unwrap_result(scorer_payload) if scorer_payload else {}
    tailor_resume_result = _unwrap_result(tailor_payload.get("resume", {}))
    tailor_answers_result = _unwrap_result(tailor_payload.get("answers", {}))

    tabs = st.tabs(["Overview", "Job Description", "Tailored Materials", "Actions"])

    with tabs[0]:
        if scorer_result:
            summary = scorer_result.get("one_line_summary", "")
            if summary:
                st.info(f"AI Summary: {summary}")

            match_col, gap_col = st.columns(2)
            with match_col:
                st.markdown("**Match Reasons**")
                for reason in scorer_result.get("match_reasons", []):
                    st.markdown(f"- {reason}")

            with gap_col:
                st.markdown("**Gap Reasons**")
                for reason in scorer_result.get("gap_reasons", []):
                    st.markdown(f"- {reason}")
        else:
            st.write("No scoring data yet. Run `python main.py` to score jobs.")

        if extracted_result:
            with st.expander("Extracted Metadata"):
                st.json(extracted_result)

        if scorer_payload or extracted_payload:
            with st.expander("LLM Attempt Logs"):
                st.json(
                    {
                        "extractor": extracted_payload,
                        "scorer": scorer_payload,
                    }
                )

    with tabs[1]:
        description = job.get("description") or "No description available."
        st.text_area(
            "description",
            description,
            height=420,
            disabled=True,
            label_visibility="collapsed",
        )

    with tabs[2]:
        tailored_summary = job.get("tailored_summary")
        cover_letter = job.get("cover_letter")

        if not tailored_summary and not cover_letter:
            if score is not None and score >= 80:
                st.warning(
                    "Tailored materials were not generated. Re-run `python main.py` "
                    "after Ollama is available."
                )
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
                for bullet in bullets:
                    st.markdown(f"- {bullet}")

            if tailor_answers_result:
                st.divider()
                why_role_col, why_hire_col = st.columns(2)
                with why_role_col:
                    st.markdown("**Why This Role**")
                    st.write(tailor_answers_result.get("why_role", ""))
                with why_hire_col:
                    st.markdown("**Why Hire Me**")
                    st.write(tailor_answers_result.get("why_hire", ""))

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

        if tailor_payload:
            with st.expander("Tailor Attempt Logs"):
                st.json(tailor_payload)

    with tabs[3]:
        if app_id is None:
            st.info(
                "This job does not have an application row yet. Run `python main.py` "
                "to initialize pipeline tracking before taking manual actions."
            )
            return

        if config.AUTO_APPLY_ENABLED:
            if config.AUTO_APPLY_DRY_RUN:
                st.info("Auto-apply is currently running in dry-run mode.")
            else:
                st.info("Auto-apply is live for supported Greenhouse forms.")

        apply_col, auto_col, skip_col, reject_col = st.columns(4)
        with apply_col:
            if st.button(
                "Mark as Applied",
                type="primary",
                use_container_width=True,
                key=f"apply_{app_id}",
            ):
                update_status(app_id, "applied")
                st.success("Marked as applied.")
                st.rerun()

        with auto_col:
            if st.button("Auto Apply Now", use_container_width=True, key=f"auto_{app_id}"):
                live_profile = get_user_profile()
                if live_profile is None:
                    st.error("No profile found.")
                else:
                    with st.spinner("Submitting application..."):
                        result = asyncio.run(
                            auto_apply_job(
                                job,
                                live_profile,
                                dry_run=config.AUTO_APPLY_DRY_RUN,
                            )
                        )
                    payload = result.model_dump()
                    if result.success and result.submitted:
                        note = "Auto-submitted via Greenhouse."
                        if result.confirmation_text:
                            note = f"{note} Confirmation: {result.confirmation_text}"
                        log_apply_success(app_id, payload, notes=note)
                        st.success("Application submitted.")
                    elif result.success and result.dry_run:
                        log_apply_dry_run(app_id, payload)
                        st.success("Dry run completed without submitting.")
                    else:
                        log_apply_failure(app_id, result.error or "unknown_auto_apply_error", payload)
                        st.error(result.error or "Auto-apply failed.")
                    st.rerun()

        with skip_col:
            if st.button("Skip Job", use_container_width=True, key=f"skip_{app_id}"):
                update_status(app_id, "skipped")
                st.warning("Job skipped.")
                st.rerun()

        with reject_col:
            if st.button("Mark Rejected", use_container_width=True, key=f"reject_{app_id}"):
                update_status(app_id, "rejected")
                st.error("Marked as rejected.")
                st.rerun()

        st.divider()
        st.markdown("**Manual Override**")

        status_col, notes_col = st.columns([1, 2])
        with status_col:
            safe_status = status if status in MANUAL_STATUSES else MANUAL_STATUSES[0]
            new_status = st.selectbox(
                "Status",
                MANUAL_STATUSES,
                index=MANUAL_STATUSES.index(safe_status),
                key=f"status_sel_{app_id}",
            )

        with notes_col:
            notes_value = st.text_area(
                "Notes",
                value=job.get("notes") or "",
                key=f"notes_{app_id}",
                height=80,
            )

        follow_col, save_col = st.columns(2)
        with follow_col:
            follow_up = st.date_input("Follow-up Date", value=None, key=f"follow_{app_id}")

        with save_col:
            st.markdown("&nbsp;", unsafe_allow_html=True)
            if st.button("Save Changes", use_container_width=True, key=f"save_{app_id}"):
                follow_up_value = str(follow_up) if follow_up else None
                update_status(
                    app_id,
                    new_status,
                    notes=notes_value,
                    follow_up_date=follow_up_value,
                )
                st.success("Saved.")
                st.rerun()

        if apply_payload:
            with st.expander("Apply Logs"):
                st.json(apply_payload)


with st.sidebar:
    st.title("Job Hunter")
    st.caption("AI-powered job pipeline")
    st.divider()

    page = st.radio(
        "Navigation",
        ["Dashboard", "Profile Settings"],
        label_visibility="collapsed",
    )

    st.divider()
    st.subheader("Filters")
    status_filter = st.selectbox("Status", ALL_STATUSES)
    score_range = st.slider("Score Range", 0, 100, (0, 100), step=5)
    companies = ["All"] + get_distinct_companies()
    company_filter = st.selectbox("Company", companies)
    sources = ["All"] + get_distinct_sources()
    source_filter = st.selectbox("Source", sources)
    search_query = st.text_input("Search", placeholder="title or company")

    st.divider()
    if st.button("Refresh Data", use_container_width=True):
        st.rerun()
    st.caption("Run `python main.py` to scrape and score jobs.")


if page == "Dashboard":
    stats = get_stats()
    stat_cols = st.columns(6)
    stat_cols[0].metric("Total Jobs", stats["total_jobs"])
    stat_cols[1].metric("Scored", stats["total_scored"])
    stat_cols[2].metric("Priority (80+)", stats["total_priority"])
    stat_cols[3].metric("Applied", stats["total_applied"])
    stat_cols[4].metric("Filtered Out", stats["total_filtered"])
    stat_cols[5].metric("Avg Score", stats["avg_score"])

    st.divider()

    jobs = load_jobs(status_filter, score_range, company_filter, source_filter, search_query)

    if not jobs:
        st.info(
            "No jobs match your filters. Run `python main.py` to scrape and score jobs."
        )
    else:
        st.subheader(f"Jobs ({len(jobs)})")

        display_rows = []
        for job in jobs:
            score = job.get("fit_score")
            display_rows.append(
                {
                    "": score_icon(score),
                    "Title": job.get("title", ""),
                    "Company": job.get("company", ""),
                    "Source": job.get("source", ""),
                    "Location": job.get("location", ""),
                    "Score": score,
                    "Status": job.get("status") or "found",
                    "Apply?": (
                        "Yes"
                        if job.get("apply_decision")
                        else ("No" if job.get("fit_score") is not None else "-")
                    ),
                    "Notes": (job.get("notes") or "")[:60],
                }
            )

        dataframe = pd.DataFrame(display_rows)
        event = st.dataframe(
            dataframe,
            use_container_width=True,
            hide_index=True,
            on_select="rerun",
            selection_mode="single-row",
        )

        selected_rows = event.selection.rows
        if selected_rows:
            selected_job = jobs[selected_rows[0]]
            st.session_state.selected_job_id = selected_job.get("job_id")

        if st.session_state.selected_job_id is not None:
            active_job = next(
                (
                    job
                    for job in jobs
                    if job.get("job_id") == st.session_state.selected_job_id
                ),
                None,
            )
            if active_job:
                st.divider()
                render_job_detail(active_job)

elif page == "Profile Settings":
    st.title("Profile Settings")
    profile = get_user_profile()

    if profile is None:
        st.error("No profile found. Run `python main.py` first to seed the profile.")
    else:
        preferences = profile.get("preferences_json", {})
        application_defaults = preferences.get("application_form_defaults", {})
        current_variant_key = preferences.get("resume_variant_key", config.ACTIVE_RESUME_KEY)
        variant_keys = list(config.RESUME_VARIANTS.keys())
        default_variant_index = (
            variant_keys.index(current_variant_key)
            if current_variant_key in variant_keys
            else 0
        )

        st.subheader("Configured Resume Variants")
        selected_variant_key = st.selectbox(
            "Resume Variant",
            options=variant_keys,
            index=default_variant_index,
            format_func=lambda key: str(config.RESUME_VARIANTS[key]["label"]),
        )
        selected_variant = config.RESUME_VARIANTS[selected_variant_key]
        st.caption(f"Source: {selected_variant['path']}")
        st.caption(
            "Target roles: " + ", ".join(selected_variant["target_roles"])  # type: ignore[index]
        )

        if st.button("Load Variant Into Profile", use_container_width=True):
            try:
                loaded_resume_text = load_resume_text(str(selected_variant["path"]))
                updated_preferences = dict(preferences)
                updated_preferences["resume_variant_key"] = selected_variant_key
                updated_preferences["resume_variant_label"] = selected_variant["label"]
                updated_preferences["resume_source_path"] = str(selected_variant["path"])
                updated_preferences["target_roles"] = list(selected_variant["target_roles"])  # type: ignore[index]
                update_user_profile(
                    resume_text=loaded_resume_text,
                    preferences_json=json.dumps(updated_preferences),
                )
                st.success("Loaded selected resume variant into your profile.")
                st.rerun()
            except Exception as exc:
                st.error(f"Could not load resume variant: {exc}")

        if application_defaults:
            st.subheader("Application Defaults")
            left_col, right_col = st.columns(2)
            with left_col:
                st.write(f"Email: {application_defaults.get('email', profile.get('email') or '')}")
                st.write(f"Phone: {application_defaults.get('phone', profile.get('phone') or '')}")
                st.write(f"Work authorization (US): {application_defaults.get('work_authorization_us', '')}")
                st.write(f"Current/Previous Employer: {application_defaults.get('current_or_previous_employer', '')}")
                st.write(f"Current/Previous Title: {application_defaults.get('current_or_previous_job_title', '')}")
            with right_col:
                st.write(f"Gender: {application_defaults.get('gender', '')}")
                st.write(f"Veteran status: {application_defaults.get('veteran_status', '')}")
                st.write(f"Disability status: {application_defaults.get('disability_status', '')}")
                st.write(f"School: {application_defaults.get('school_name', '')}")
                st.write(f"Degree: {application_defaults.get('degree', '')}")
            st.caption(
                "These defaults are stored for application questions only. "
                "They are not used to score or rank jobs."
            )
            st.caption(
                f"Scheduler: every {config.SCHEDULER_INTERVAL_HOURS} hour(s) | "
                f"Auto-apply enabled: {config.AUTO_APPLY_ENABLED} | "
                f"Dry run: {config.AUTO_APPLY_DRY_RUN}"
            )

        with st.form("profile_form"):
            left_col, right_col = st.columns(2)
            with left_col:
                name = st.text_input("Name", value=profile.get("name") or "")
                email = st.text_input("Email", value=profile.get("email") or "")
            with right_col:
                phone = st.text_input("Phone", value=profile.get("phone") or "")

            resume_text = st.text_area(
                "Resume Text (plain text - used in all LLM prompts)",
                value=profile.get("resume_text") or "",
                height=400,
            )

            preferences_raw = st.text_area(
                "Preferences JSON",
                value=json.dumps(preferences, indent=2),
                height=220,
            )

            submitted = st.form_submit_button("Save Profile", type="primary")
            if submitted:
                try:
                    parsed_preferences = json.loads(preferences_raw)
                    update_user_profile(
                        name=name,
                        email=email,
                        phone=phone,
                        resume_text=resume_text,
                        preferences_json=json.dumps(parsed_preferences),
                    )
                    st.success("Profile saved successfully.")
                except json.JSONDecodeError as exc:
                    st.error(f"Invalid JSON in preferences: {exc}")
