# Operations

## Recommended Runtime

The recommended runtime is now the TypeScript SaaS stack:

- `apps/web` for the marketing site, authenticated UI, and API routes
- `apps/worker` for ingestion, scoring, tailoring, preparation, and automation
- Postgres via Prisma for persistence

The legacy Python stack is still present as reference material, but it is no longer the primary operating path.

## Safe Defaults

Current operational defaults are intentionally conservative:

- `JOBHUNTER_AUTO_APPLY_ENABLED=false`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN=true`

That means the worker can discover, score, tailor, and prepare applications without live-submitting to external sites unless you explicitly opt in.

The system must pause rather than bypass:

- CAPTCHA
- verification codes
- security prompts
- failed uploads
- unknown or ambiguous form states

## Local Runbook

### Start Postgres

```powershell
docker compose up -d postgres
```

### Apply migrations

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run db:deploy
```

### Seed demo data

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
$env:JOBHUNTER_ENABLE_DEMO_SEED="true"
npm run db:seed
```

Demo credentials after seeding:

- email: `demo@jobhunter.local`
- password: `DemoPass123!`

### Complete onboarding and upload a resume

Before the worker can do useful work for an account:

- onboarding must be completed
- at least one resume must be uploaded
- a default resume must exist

The first uploaded resume becomes the default automatically unless changed later.

The uploaded file is used for automation uploads. The pasted base resume text is used for scoring, tailoring, and short-answer generation.

### Run the web app

```powershell
npm run dev --workspace @jobhunter/web
```

Then open `http://localhost:3000`, log in, complete onboarding, upload a resume, and use the dashboard's `Run worker now` action if you want to trigger a single cycle from the UI.

### Run the worker once

```powershell
$env:DATABASE_URL="postgresql://jobhunter:jobhunter@localhost:5432/jobhunter"
npm run start --workspace @jobhunter/worker
```

If the worker reports `processedUsers: 0`, the usual reasons are:

- no onboarded users exist
- no default resume exists for the user
- the account only has partial setup

### Build verification

```powershell
npm run typecheck
npm run build --workspace @jobhunter/web
```

## Docker Compose Runbook

Run the full stack:

```powershell
docker compose up --build
```

Services:

- `postgres`
- `migrate`
- `web`
- `worker`

## Source Coverage

Current source ingestion coverage:

- Mock
- Greenhouse
- Ashby
- Lever
- Workable

Current automated submission coverage:

- Greenhouse

Default source targets when environment variables are not overridden:

- Greenhouse: `stripe`, `figma`
- Ashby: `vercel`, `retool`
- Lever: `box`
- Workable: none by default
- Mock demo feed: enabled

## What `needs_user_action` Means

An application should enter `needs_user_action` when automation hits friction such as:

- CAPTCHA
- email or security verification
- upload failures
- unknown required fields
- unusual form structure
- uncertain submit state

When this happens, the system should preserve:

- latest application URL
- tailored resume and answer artifacts
- structured autofill data
- checkpoint artifacts when captured

The user can then resume the live application or reopen it from the app dashboard.

Checkpoint artifacts are written under:

- `data/manual_checkpoints/<applicationId>/`

## Important Environment Variables

- `DATABASE_URL`
- `AUTH_SECRET`
- `JOBHUNTER_ENABLE_DEMO_SEED`
- `JOBHUNTER_AUTO_APPLY_ENABLED`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN`
- `PLAYWRIGHT_HEADLESS`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `JOBHUNTER_GREENHOUSE_BOARDS`
- `JOBHUNTER_ASHBY_BOARDS`
- `JOBHUNTER_LEVER_SITES`
- `JOBHUNTER_WORKABLE_COMPANIES`

## File Locations

- uploaded resumes: `data/uploads/resumes/`
- seeded demo resume: `data/resumes/demo/`
- manual checkpoints: `data/manual_checkpoints/`

## Legacy Python Notes

The Python implementation still matters as reference for:

- Greenhouse safety behavior in `submitter/greenhouse.py`
- form grounding logic in `llm/form_resolver.py`
- source-specific discovery heuristics in `scraper/`

If you intentionally need the legacy runtime, use:

```powershell
docker compose -f docker-compose.legacy-python.yml up --build
```
