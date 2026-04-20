# Job Hunter

Job Hunter is a local-first Python pipeline for finding software jobs, scoring them against a candidate profile, generating tailored application materials, and auto-submitting supported applications through Greenhouse.

The project has three main runtime surfaces:

- `main.py`: one pipeline run for discovery, scoring, tailoring, and auto-apply.
- `scheduler.py`: recurring pipeline loop that runs every `SCHEDULER_INTERVAL_HOURS`.
- `dashboard/app.py`: Streamlit dashboard for reviewing jobs, editing the profile, and manually triggering auto-apply.

## Current Behavior

- The scheduler interval is `1` hour by default.
- Auto-apply is enabled by default.
- Auto-apply dry-run mode is disabled by default.
- Only Greenhouse candidate-side application flows are supported for submission today.
- The software-engineer profile uses repo-local canonical resume text for LLM prompts and a `.docx` file for actual uploads.

## Profile Sources

The active software-engineer profile is split into two sources on purpose:

- LLM prompt text source: [profiles/liban_britt_software_engineer.md](profiles/liban_britt_software_engineer.md)
- Resume upload source: `C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_SWE_Current.docx`

This keeps the scoring/tailoring profile text stable in-repo while still giving the submitter a Word document to upload to application forms.

The default profile bootstrap and scheduler/apply defaults live in [config.py](config.py).

## Local Run

Create a venv, install dependencies, and install the Playwright browser:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
```

Run one pipeline cycle:

```powershell
python main.py
```

Run the recurring scheduler:

```powershell
python scheduler.py
```

Run the dashboard:

```powershell
python -m streamlit run dashboard/app.py --server.port 8501
```

## Docker Compose

`docker-compose.yml` defines:

- `ollama`: local model server
- `model-pull`: one-time pull for `llama3.1:8b-instruct-q4_K_M`
- `dashboard`: Streamlit UI on port `8501`
- `scheduler`: recurring 1-hour pipeline loop with auto-apply enabled
- `scraper`: one-shot pipeline container for manual runs

Start the long-running services:

```powershell
docker compose up -d ollama model-pull dashboard scheduler
```

Check service status:

```powershell
docker compose ps
```

View scheduler logs:

```powershell
docker compose logs -f scheduler
```

## Auto-Apply Rules

Auto-apply currently runs at the end of each pipeline cycle and only targets jobs that satisfy all of the following:

- application `status = 'scored'`
- `apply_decision = 1`
- `fit_score >= AUTO_APPLY_MIN_SCORE`
- the source is supported by a submitter

Today the only live submitter is Greenhouse, implemented in [submitter/greenhouse.py](submitter/greenhouse.py). Unsupported sources fail closed rather than attempting a partial submission.

## Dashboard

The dashboard supports:

- filtering jobs by status, score, company, and source
- reviewing extracted/scored/tailored data
- editing the stored profile and preferences JSON
- loading configured resume variants into the profile
- manually triggering auto-apply for a selected job

For ATS-specific recurring questions, store explicit answers under:

`preferences_json.application_form_defaults.custom_question_answers`

Example:

```json
[
  {
    "label": "Have you previously applied to Amazon or any Amazon subsidiary?",
    "value": "No",
    "kind": "select"
  },
  {
    "label": "Are you open to relocation?",
    "value": "No",
    "kind": "select"
  }
]
```

Greenhouse auto-apply also uses the local Ollama model to resolve semantically
similar required question labels when the answer is already grounded in your
stored profile or generated application text. It still fails closed for
questions that should not be guessed, such as work authorization, sponsorship,
citizenship, prior applications, prior employment, relocation preference, and
non-compete restrictions, unless you have stored an explicit answer in the
profile defaults.

Every LLM-produced form answer is post-validated before fill:

- custom answers must match `custom_question_answers`
- profile answers must match both the explicit stored value and the right profile field label
- generated open-text answers must match stored generated materials and only fill fit/motivation-style prompts

If the answer cannot be traced back to one of those sources, it is rejected and
the form remains blocked instead of autofilling a guessed response.

Profile data is stored in SQLite under `user_profile`, and the dashboard reads/writes it through [database/db.py](database/db.py).

## Logs and Data

Local runtime state is stored in:

- `data/`: SQLite database and related WAL files
- `logs/`: local scheduler and dashboard process logs

These directories are intentionally ignored by git.

To wipe discovered jobs and applications while keeping the profile:

```powershell
@'
from database.db import reset_job_data
reset_job_data()
'@ | python -
```

## Known Limits

- Auto-apply support is Greenhouse-only.
- Some application forms use anti-bot protection such as invisible reCAPTCHA; those are blocked and reported rather than silently retried.
- External profile upload files are referenced by absolute local paths.
- The scheduler must be kept running as a process or service if you want continuous 1-hour execution.

More operational detail is in [docs/OPERATIONS.md](docs/OPERATIONS.md).
