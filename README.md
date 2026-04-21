# JobHunter

JobHunter is a human-in-the-loop job application system.

Core promise:

> We find, prepare, fill, and submit job applications for you when possible. When a site needs you, we pause and make it as easy as possible to finish.

This repository now contains the actively developed TypeScript SaaS stack in `apps/` and `packages/`, plus the original Python implementation preserved as migration reference material.

Supporting docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation TODOs](docs/TODO.md)
- [Legacy Python operations](docs/OPERATIONS.md)

## Current Status

Implemented in the TypeScript stack:

- polished marketing site at `/`
- credential signup, login, logout, and cookie-backed sessions
- authenticated app routes for dashboard, jobs, applications, profile, onboarding, and resumes
- structured user profile and preferences persisted in Postgres via Prisma
- resume upload persistence plus tailored `ResumeVersion` records
- Prisma-backed dashboard, jobs, applications, and notifications pages
- modular job ingestion adapters for Mock, Greenhouse, Ashby, Lever, and Workable
- rules-first scoring pipeline with persisted `JobScore`, `TailoredDocument`, and `GeneratedAnswer` records
- worker pipeline that discovers jobs, scores fit, prepares applications, tracks events, and raises notifications
- Greenhouse Playwright apply flow with fail-closed checkpoint handling and structured autofill
- manual-action workflow with prepared payload persistence and resume/reopen support
- Dockerized `web`, `worker`, `migrate`, and `postgres` services

Still intentionally incomplete:

- OAuth providers and production auth hardening
- queue/scheduler infrastructure beyond direct worker runs
- broader ATS automation coverage beyond the current Greenhouse path
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

That means a local worker run will discover, score, prepare, and track applications by default, but it will not live-submit to external sites unless you explicitly opt in.

The automation layer never attempts to bypass:

- CAPTCHA
- verification codes
- security prompts

Those cases are saved as `needs_user_action` with prepared data and resume artifacts.

## Environment Variables

See [.env.example](.env.example) for the full template.

Important variables:

- `DATABASE_URL`
- `AUTH_SECRET`
- `JOBHUNTER_ENABLE_DEMO_SEED`
- `JOBHUNTER_AUTO_APPLY_ENABLED`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN`
- `PLAYWRIGHT_HEADLESS`
- `OPENAI_API_KEY` and `OPENAI_MODEL` for OpenAI-backed LLM calls
- `OLLAMA_URL` and `OLLAMA_MODEL` for Ollama-backed local LLM calls
- `JOBHUNTER_GREENHOUSE_BOARDS`
- `JOBHUNTER_ASHBY_BOARDS`
- `JOBHUNTER_LEVER_SITES`
- `JOBHUNTER_WORKABLE_COMPANIES`

When no LLM provider is configured, the services fall back to deterministic mock output so the pipeline still runs.

## Local Development

### Option 1: Docker Compose

Start the full local stack:

```powershell
docker compose up --build
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

## Demo Workflow

With demo seed enabled, the repository creates:

- a demo user
- completed onboarding data
- preferences and a default resume
- seeded prompt templates
- sample seeded application records

The worker has also been validated locally against Docker Postgres with a seeded onboarded user. In the current configuration it discovers jobs, scores fit, prepares applications, and records tracker state without performing live submission by default.

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
