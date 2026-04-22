# JobHunter

JobHunter is a human-in-the-loop job application system.

Core promise:

> We find, prepare, fill, and submit job applications for you when possible. When a site needs you, we pause and make it as easy as possible to finish.

This repository now contains the actively developed TypeScript SaaS stack in `apps/` and `packages/`, plus the original Python implementation preserved as migration reference material.

Supporting docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation TODOs](docs/TODO.md)
- [Operations](docs/OPERATIONS.md)

## Current Status

Implemented in the TypeScript stack:

- polished marketing site at `/`
- credential signup, login, logout, and cookie-backed sessions
- authenticated app routes for dashboard, jobs, applications, profile, onboarding, and resumes
- authenticated operator UI regrouped around `Ready to run`, `Needs attention`, and `Submitted`
- jobs and applications filters for search, status, and location presets including `Greater Seattle Area`
- structured user profile and preferences persisted in Postgres via Prisma
- resume upload persistence plus tailored `ResumeVersion` records
- Prisma-backed dashboard, jobs, applications, and notifications pages
- modular job ingestion adapters for Mock, Greenhouse, Ashby, Lever, and Workable
- rules-first scoring pipeline with persisted `JobScore`, `TailoredDocument`, and `GeneratedAnswer` records
- worker pipeline that discovers jobs, scores fit, prepares applications, tracks events, and raises notifications
- Playwright autofill flows for Greenhouse and the local mock apply pages
- LLM-assisted field resolution with semantic cache persistence for unfamiliar field labels
- manual-action workflow with prepared payload persistence, saved resume points, and resume/reopen support
- browser-visible mock autofill handoff that opens the local apply page, fills it from the prepared packet, and records the confirmation back into the tracker
- rolling 24-hour daily target enforcement that queues overflow jobs before tailoring work is generated
- application-state reconciliation so worker reruns preserve submitted and paused items instead of downgrading them
- Dockerized `web`, `worker`, `migrate`, and `postgres` services

Validated locally on April 22, 2026:

- login with a seeded real user succeeded
- `Open browser autofill` redirected into `/mock/apply/*`
- the mock form filled in-browser from the prepared packet
- the confirmation page moved the application to `auto_submitted`
- the live queue rendered `Run live autofill` actions for supported Greenhouse applications
- the jobs page filtered the feed down to a Greater Seattle area slice

Still intentionally incomplete:

- OAuth providers and production auth hardening
- queue/scheduler infrastructure beyond direct worker runs
- broader ATS automation coverage beyond the current Greenhouse and local mock paths
- richer tests, observability, and outcome analytics
- browser-extension-facing APIs beyond the current backend shape

## Repository Layout

```text
apps/
  web/        Next.js marketing site, authenticated app, and API routes
  worker/     ingestion, scoring, tailoring, preparation, and automation pipeline

packages/
  core/       shared domain types, API contracts, rules, and autofill helpers
  db/         Prisma schema, migrations, seed data, queries, and pipeline persistence
  llm/        job scoring, resume tailoring, and short-answer generation services
  automation/ Playwright automation and checkpoint capture
  job-sources source adapters for supported job feeds
```

## Safety Defaults

The product can auto-submit when the application flow is simple and reliable, but the repository defaults are intentionally conservative for local development:

- `JOBHUNTER_AUTO_APPLY_ENABLED=false`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN=true`
- `JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED=true`

That means the worker will still discover, score, prepare, and track applications without background autonomous submission by default, but user-triggered live Greenhouse autofill is available in the UI for supported applications. The local mock apply flow remains available so you can verify browser-visible autofill safely inside Docker.

The automation layer never attempts to bypass:

- CAPTCHA
- verification codes
- security prompts

Those cases are saved as `needs_user_action` with prepared data and resume artifacts.

## Supported Sources

Current ingestion adapters:

- Mock
- Greenhouse
- Ashby
- Lever
- Workable

Current automated submission path:

- local Mock apply pages
- Greenhouse when the queue offers `Run live autofill`

Everything else can still be discovered, scored, filtered, tailored, and tracked, but not all sources can be fully auto-submitted yet.

## Environment Variables

See [.env.example](.env.example) for the full template.

Important variables:

- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `JOBHUNTER_ENABLE_DEMO_SEED`
- `JOBHUNTER_AUTO_APPLY_ENABLED`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN`
- `JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED`
- `PLAYWRIGHT_HEADLESS`
- `OPENAI_API_KEY` and `OPENAI_MODEL` for OpenAI-backed LLM calls
- `OLLAMA_URL` and `OLLAMA_MODEL` for Ollama-backed local LLM calls
- `JOBHUNTER_GREENHOUSE_BOARDS`
- `JOBHUNTER_ASHBY_BOARDS`
- `JOBHUNTER_LEVER_SITES`
- `JOBHUNTER_WORKABLE_COMPANIES`

When no LLM provider is configured, the services fall back to deterministic mock output so the pipeline still runs.

`NEXT_PUBLIC_APP_URL` should be set to the public base URL for the web app. Auth and dashboard POST routes use it for redirects, and they also honor forwarded host/protocol headers when the app is deployed behind Docker or a reverse proxy.

## First Run Flow

For a clean local test of the current product surface:

1. Start Postgres and apply migrations.
2. Create an account or seed the demo account.
3. Complete onboarding so the structured profile and preferences exist.
4. Upload at least one base resume from the Resumes page.
5. Trigger a pipeline cycle from the dashboard or run the worker from the CLI.
6. Use `Open browser autofill` or `Run live autofill` from the Dashboard, Jobs, or Applications page for supported apply flows.
7. Review any `Needs attention` items and use `Resume paused step` if the site paused the automation.
8. If your daily target is full, expect additional matched jobs to remain queued until the next slot opens.

Important behavior:

- the worker only processes users who have completed onboarding
- the worker also requires a default resume before it can score and prepare applications
- the uploaded file and the pasted base resume text are both important
- the file is used for resume upload during automation
- the pasted base text is what scoring, tailoring, and answer generation use
- `Open browser autofill` is the action that starts the local visible mock flow
- `Run live autofill` starts Playwright on a supported Greenhouse application
- `Open application only` opens the employer page directly and does not trigger automation by itself
- on local mock flows, `Open browser autofill` redirects into the mock application page and visibly fills the form in-browser
- on supported live ATS flows, `Run live autofill` runs the worker-side automation and then opens the step it reached
- the Jobs and Applications pages both support search, status filtering, and location presets including `Greater Seattle Area`

## Application Actions

The authenticated queue now uses explicit action labels so the intent is obvious:

- `Open browser autofill`: start the visible local mock autofill flow
- `Run live autofill`: start live Playwright automation for a supported Greenhouse flow
- `Open application only`: open the employer form without triggering automation
- `Resume paused step`: reopen the last page reached by automation after it paused for human input
- `Mark submitted`: manually confirm completion if you finished the application yourself

The most important distinction is that `Ready to run` means the packet is prepared in JobHunter, but the employer site is not complete yet. `Submitted` means the system or the user confirmed a real completion state.

## Local Development

### Option 1: Docker Compose

Start the full local stack:

```powershell
docker compose up --build
```

If the stack is already running and you want the latest code live after local changes:

```powershell
docker compose up -d --build web worker
```

This starts:

- `postgres`
- `migrate`
- `web`
- `worker`

Open:

- marketing site and app UI: `http://localhost:3000`

### Option 2: Run Services Locally

1. Install dependencies:

```powershell
npm install
```

2. Start Postgres with Docker:

```powershell
docker compose up -d postgres
```

3. Apply migrations against the local database:

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run db:deploy
```

4. Optionally seed demo data:

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
$env:JOBHUNTER_ENABLE_DEMO_SEED="true"
npm run db:seed
```

5. Verify and run the app:

```powershell
npm run typecheck
npm run build --workspace @jobhunter/web
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run start --workspace @jobhunter/worker
npm run dev --workspace @jobhunter/web
```

You can also trigger a single authenticated worker cycle from the dashboard with the `Run worker now` action.

## Demo Workflow

With demo seed enabled, the repository creates:

- a demo user
- completed onboarding data
- preferences and a default resume
- seeded prompt templates
- sample seeded application records

Demo credentials:

- email: `demo@jobhunter.local`
- password: `DemoPass123!`

The worker has also been validated locally against Docker Postgres with a seeded onboarded user. In the current configuration it discovers jobs, scores fit, prepares applications, and records tracker state without performing live submission by default.

The demo mock jobs are wired to local `/mock/apply/*` pages so you can verify the full visible handoff:

- click `Open browser autofill`
- land on the real local mock application page
- watch the prepared packet fill in-browser
- submit into the local confirmation page
- see the tracker move the application into `Auto-submitted`

## Default Discovery Targets

If you do not override the source environment variables, the worker uses these built-in defaults:

- Greenhouse: `stripe`, `figma`
- Ashby: `vercel`, `retool`
- Lever: `box`
- Workable: disabled unless `JOBHUNTER_WORKABLE_COMPANIES` is set
- Mock feed: always enabled

If you want a narrower or different set of job sources, set the corresponding `JOBHUNTER_*` environment variables explicitly before running the worker.

## Status Meanings

The main application states a user will see are:

- `queued`: the job passed the fit rules but is waiting because the rolling 24-hour target is full
- `prepared`: shown in the UI as `Ready to run`; tailored materials and prepared payloads are saved in JobHunter, but the employer site is not necessarily filled yet
- `needs_user_action`: the worker reached the live application flow, preserved state, and paused because a human was required
- `auto_submitted`: automation detected a clear successful submission state on the employer site
- `submitted`: the application is complete because it was confirmed automatically or manually marked submitted after user completion

When an application enters `needs_user_action`, the system is expected to preserve:

- the latest application URL
- tailored resume and answer artifacts
- prepared structured defaults
- checkpoint screenshots or page captures when available

Use the Applications page to either resume the interrupted flow or reopen the application for another worker attempt.
If you finish an application yourself from a prepared packet or paused flow, use the `Mark submitted` action so the dashboard reflects that it is actually complete.
Worker reruns preserve `auto_submitted`, `submitted`, and `needs_user_action` records instead of rewriting them back to `prepared`.
The dashboard also shows how many preparation slots were used in the last 24 hours and how many remain before more jobs can leave the queued bucket.

## File Locations

Important runtime files are stored under `data/`:

- uploaded resumes: `data/uploads/resumes/`
- seeded demo resume: `data/resumes/demo/`
- manual checkpoint captures: `data/manual_checkpoints/<applicationId>/`
- semantic field cache: `data/cache/field-resolution-cache.json`

Checkpoint directories can contain screenshots, HTML captures, and extracted text for paused automation flows.

## Important Limitations

Current behavior a user should know before relying on the system:

- background autonomous worker submission is intentionally off by default
- automation does not bypass CAPTCHA, email codes, or security checks
- local Mock and Greenhouse are the only implemented autofill paths today
- live Greenhouse autofill is enabled in the Docker stack by default, but other ATS flows remain unsupported
- if no LLM provider is configured, the pipeline uses deterministic mock output rather than live model calls
- the worker currently runs on demand rather than from a production queue or scheduler

## Legacy Python Reference

The legacy Python code remains in the repository as implementation reference, not as the primary runtime:

- `scraper/`
- `llm/`
- `submitter/`
- `tracker/`
- `dashboard/`

It is still useful for:

- ATS-specific heuristics
- proven Greenhouse safety behavior
- form grounding logic
- prompt structure reference

Legacy Docker files remain available as:

- `Dockerfile.legacy-python`
- `docker-compose.legacy-python.yml`
