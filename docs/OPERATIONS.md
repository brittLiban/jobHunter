# Operations

## Runtime Modes

There are two normal ways to run Job Hunter:

- Local Python processes on Windows
- Docker Compose services

The behavior should be the same in both cases:

- run discovery and scoring
- generate tailoring for high-priority jobs
- auto-apply eligible Greenhouse jobs
- repeat every 6 hours when running through `scheduler.py`

## Local Windows Runbook

### Start the scheduler

```powershell
python scheduler.py
```

This runs forever and sleeps based on `SCHEDULER_INTERVAL_HOURS` after each completed cycle.

### Start the dashboard

```powershell
python -m streamlit run dashboard/app.py --server.headless true --server.address 127.0.0.1 --server.port 8501
```

### Run a single cycle manually

```powershell
python main.py
```

## Current Scheduler / Auto-Apply Settings

The defaults in [config.py](../config.py) are:

- `SCHEDULER_INTERVAL_HOURS = 6`
- `AUTO_APPLY_ENABLED = True`
- `AUTO_APPLY_DRY_RUN = False`
- `AUTO_APPLY_MIN_SCORE = 80`

The Docker scheduler service in [docker-compose.yml](../docker-compose.yml) also pins:

- `SCHEDULER_INTERVAL_HOURS=6`
- `AUTO_APPLY_ENABLED=true`
- `AUTO_APPLY_DRY_RUN=false`

## How Auto-Apply Actually Runs

Auto-apply is not a separate daemon. It is the final phase of each pipeline cycle in [main.py](../main.py):

1. discover jobs
2. insert new jobs
3. extract and score unprocessed jobs
4. tailor priority jobs
5. auto-apply eligible jobs

An application is eligible for queue pickup when it is:

- `status = 'scored'`
- recommended to apply
- at or above the configured score threshold

Submission is dispatched through [submitter/service.py](../submitter/service.py). Unsupported sources fail closed.

## Supported Submission Paths

Currently supported:

- Greenhouse

Not currently supported:

- Lever
- Ashby
- Workable
- generic company-site forms

This means the pipeline can discover and score jobs from many sources, but only a subset can be auto-submitted.

## Profile and Resume Files

The active software-engineer profile currently uses:

- prompt text: [../profiles/liban_britt_software_engineer.md](../profiles/liban_britt_software_engineer.md)
- upload file: `C:\Users\liban\Desktop\01_Career\Resumes\Liban_Britt_SWE_Current.docx`

The prompt text is what the LLM sees for extraction, scoring, and tailoring. The `.docx` file is what Playwright uploads during actual applications.

## Logs

If you run locally, write stdout/stderr to files under `logs/` so you can inspect cycles later.

Typical files:

- `logs/scheduler.log`
- `logs/scheduler.err`
- `logs/dashboard.log`
- `logs/dashboard.err`

Useful commands:

```powershell
Get-Content logs\scheduler.log -Tail 80
Get-Content logs\scheduler.err -Tail 80
```

## Verification Checks

### Confirm the scheduler process is running

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'scheduler.py' } |
  Select-Object ProcessId, CommandLine
```

### Confirm the dashboard is listening on port 8501

```powershell
netstat -ano | Select-String ':8501'
```

### Confirm Ollama is reachable

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing
```

### Check auto-apply queue size in SQLite

```powershell
@'
import sqlite3
conn = sqlite3.connect("data/jobs.db")
sql = """
SELECT COUNT(*)
FROM applications
WHERE status = 'scored'
  AND COALESCE(apply_decision, 0) = 1
  AND COALESCE(fit_score, 0) >= 80
"""
print(conn.execute(sql).fetchone()[0])
'@ | python -
```

## Failure Modes to Watch

- Ollama unavailable: extraction/scoring/tailoring will fail.
- Playwright browser missing: auto-apply will fail before submission.
- Resume upload file missing: Greenhouse submission will fail closed.
- Scheduler not running: nothing happens every 6 hours regardless of config values.
- Unsupported source: the job may be scored and marked as good, but it will not auto-submit.
