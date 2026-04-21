# JobHunter

JobHunter is a human-in-the-loop job application system.

Core promise:

> We find, prepare, fill, and submit job applications for you when possible. When a site needs you, we pause and make it as easy as possible to finish.

This repository now contains two layers:

- The new TypeScript SaaS scaffold in `apps/` and `packages/`
- The original Python pipeline, preserved as a reference implementation for discovery, scoring prompts, form grounding, and Greenhouse safety behavior

Supporting docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Implementation TODOs](docs/TODO.md)
- [Legacy Python operations](docs/OPERATIONS.md)

## Reuse Audit

The existing Python system was not discarded. It is being reused as reference material for:

- job discovery source patterns
- job scoring and resume tailoring prompt shapes
- conservative form-grounding rules
- Playwright safety behavior for CAPTCHA, verification, and failed-submit checkpoints

The existing Streamlit + SQLite runtime is not the long-term SaaS path. The new SaaS path uses Next.js, Prisma, and Postgres while keeping the Python implementation available for comparison and migration work.

Legacy Docker files were preserved as:

- `Dockerfile.legacy-python`
- `docker-compose.legacy-python.yml`

## Workspace Layout

```text
apps/
  web/        Next.js marketing site + authenticated app shell + route handlers
  worker/     background worker scaffold for ingestion, scoring, tailoring, and apply planning

packages/
  core/       shared domain types, statuses, rules engine helpers, anti-repetition logic
  db/         Prisma schema, initial SQL migration, Prisma config, seed data
  llm/        modular scorer, resume tailor, and short-answer generator services
  automation/ Playwright-facing checkpoint detection and submit planning
  job-sources/mock adapter layer for ingestion
```

## Current Checkpoint

Implemented in this checkpoint:

- multi-package TypeScript workspace
- polished marketing site at `/`
- authenticated app shell routes at `/dashboard`, `/jobs`, `/applications`, `/profile`
- shared job/application statuses and structured profile field definitions
- initial anti-repetition utility for generated answers
- Prisma schema for:
  - users
  - user profiles
  - user preferences
  - resumes
  - resume versions
  - job sources
  - jobs
  - job scores
  - tailored documents
  - generated answers
  - applications
  - application events
  - notifications
  - prompt templates
- initial SQL migration in `packages/db/prisma/migrations/0001_init`
- demo seed script
- mock job source adapter
- modular LLM service scaffolds for:
  - job scoring
  - resume tailoring
  - short answers
- automation planning layer that pauses on manual checkpoints instead of bypassing them
- Dockerized `web`, `worker`, `migrate`, and `postgres` services

Not implemented yet:

- real auth flow
- onboarding persistence
- resume uploads
- real job source syncs beyond mock data
- live Playwright application submission
- dashboard data loaded from Postgres instead of demo fixtures

Those are tracked in [docs/TODO.md](docs/TODO.md).

## Prisma Models

Primary Prisma models introduced in `packages/db/prisma/schema.prisma`:

- `User`
- `UserAccount`
- `UserSession`
- `UserProfile`
- `UserPreference`
- `Resume`
- `ResumeVersion`
- `JobSource`
- `Job`
- `JobScore`
- `TailoredDocument`
- `GeneratedAnswer`
- `Application`
- `ApplicationEvent`
- `Notification`
- `PromptTemplate`

The schema is Postgres-first and designed so a future browser extension can reuse the same profile, scoring, tailoring, and application APIs.

## Local Development

### 1. Install dependencies

```powershell
npm install
```

### 2. Generate Prisma client

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run db:generate
```

### 3. Verify the workspace

```powershell
npm run typecheck
npm run build --workspace @jobhunter/web
npm run start --workspace @jobhunter/worker
```

### 4. Apply migrations and seed demo data

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run db:deploy
npm run db:seed
```

## Docker Compose

The default `docker-compose.yml` now targets the SaaS stack:

- `postgres`: primary database
- `migrate`: applies Prisma migrations
- `web`: Next.js app on port `3000`
- `worker`: background processing scaffold

Start the stack:

```powershell
docker compose up --build
```

If you need the older local Python pipeline instead, use:

```powershell
docker compose -f docker-compose.legacy-python.yml up --build
```

Open:

- marketing site and app shell: `http://localhost:3000`

Environment defaults live in `.env.example`.

## Product Rules Embedded In The Architecture

The new shared domain layer already encodes the core product behavior:

- structured profile facts are distinct from LLM-generated text
- automation pauses on friction or uncertainty
- auto-submit is allowed only when flow simplicity and confidence are high
- CAPTCHA and verification handling is pause-only, never bypass

## Legacy Python Reference

The pre-existing Python implementation remains in the repository and is still useful when porting functionality:

- `scraper/`
- `llm/`
- `submitter/`
- `tracker/`
- `dashboard/`

These modules are the reference source for:

- ATS-specific heuristics
- safety-first submit behavior
- form question grounding
- prompt structure

## Next Steps

Immediate next implementation slices:

1. wire real auth and onboarding to the Prisma models
2. replace demo dashboard data with Prisma-backed queries
3. add resume upload and version management
4. add real ingestion adapters after the mock source layer
5. connect Playwright automation to the new application model and checkpoint flow
