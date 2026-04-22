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
- `JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED=true`

That means the worker can still discover, score, tailor, and prepare applications without background autonomous submission by default, while user-triggered live Greenhouse autofill remains available in the UI. Local mock apply pages are still allowed so the full visible autofill and submit loop can be verified safely in Docker.

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
The discovery controls in onboarding and Settings decide what the worker is allowed to keep:

- enabled sources
- target locations
- seniority targets
- include keywords
- exclude keywords

If a job fails those controls, it is dropped before it ever reaches the queue.

### Run the web app

```powershell
npm run dev --workspace @jobhunter/web
```

Then open `http://localhost:3000`, log in, complete onboarding, upload a resume, and use the dashboard's `Run worker now` action if you want to trigger a single cycle from the UI.

After the worker prepares applications:

- use `Open browser autofill` to start the visible local mock flow
- use `Run live autofill` to start Playwright on a supported Greenhouse application
- use `Open application only` when you want to inspect the employer page yourself without triggering automation
- if the flow pauses, use `Open paused page` to continue from the latest captured page
- if the rolling 24-hour target is full, matched jobs stay queued until capacity opens instead of generating more tailored artifacts
- use the Jobs or Applications filters to narrow the queue by search text, status, or the `Greater Seattle Area` location preset

Local mock flow behavior is intentionally more obvious than before:

- `Open browser autofill` redirects into the local `/mock/apply/*` page
- the browser-visible form is filled from the prepared packet
- the mock confirmation page marks the tracker complete automatically

If you want a safe local verifier where every visible autofill works end to end, keep `Mock` enabled in Settings and disable live sources until you are ready to test real ATS pages.

Live supported ATS behavior is different:

- the worker performs live Greenhouse autofill in Playwright
- then the app opens the current step that the worker reached
- the queue records how many fields were autofilled and which required questions still need the user
- unresolved required questions can be saved in the queue so the next retry reuses those answers
- if the flow pauses on friction, the application moves into `Needs attention`

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

If the compose stack is already running and you want the current workspace changes to take effect, rebuild and recycle the app services:

```powershell
docker compose up -d --build web worker
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

- local Mock apply pages
- Greenhouse when `JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED=true`

Default source targets when environment variables are not overridden:

- Greenhouse: `stripe`, `figma`
- Ashby: `vercel`, `retool`
- Lever: `box`
- Workable: none by default
- Mock demo feed: enabled

User-level discovery controls still apply on top of those defaults. A source being enabled in the environment does not mean its jobs will be persisted for a given user.

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
If the user completes the application manually, they should mark it submitted from the Applications page so the tracker and dashboard move it out of the attention queue.
If the dashboard shows `Saved resume point`, that link opens the most recent page the automation reached. It is the fastest way to confirm what was already filled before you continue.
For live ATS pages, that reopened URL may still be a fresh browser session. The queue's autofill summary is the source of truth for what the worker already completed.

Checkpoint artifacts are written under:

- `data/manual_checkpoints/<applicationId>/`

## Autofill Resolution

Supported autofill behavior today:

- common profile fields come from structured profile data, not the LLM
- role seniority is classified during ingestion and stored on the job record
- unfamiliar field labels can be resolved through the field resolver LLM
- successful label mappings are cached in `data/cache/field-resolution-cache.json`
- seniority classification is cached in `data/cache/job-seniority-cache.json`
- scoring, resume tailoring, and short-answer generation use normalized request caching in `data/cache/llm-semantic-cache.json`
- worker reruns preserve `auto_submitted`, `submitted`, and `needs_user_action` states instead of rewriting them to `prepared`
- the worker enforces `dailyTargetVolume` over a rolling 24-hour window before generating tailored materials
- jobs above the cap remain in `queued` so token-heavy tailoring work is deferred until the next slot opens

The dashboard intent is:

- `Open browser autofill`: start the visible local mock automation flow
- `Run live autofill`: start live Greenhouse automation
- `Open application only`: open the employer page without automation
- `Open paused page`: reopen the last page reached by automation

Current queue labels:

- `Ready to run`: packet prepared, site not completed yet
- `Needs attention`: automation reached the site and paused on real friction
- `Submitted`: confirmed complete

## Important Environment Variables

- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `JOBHUNTER_ENABLE_DEMO_SEED`
- `JOBHUNTER_AUTO_APPLY_ENABLED`
- `JOBHUNTER_AUTO_APPLY_DRY_RUN`
- `JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED`
- `PLAYWRIGHT_HEADLESS`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `JOBHUNTER_GREENHOUSE_BOARDS`
- `JOBHUNTER_ASHBY_BOARDS`
- `JOBHUNTER_LEVER_SITES`
- `JOBHUNTER_WORKABLE_COMPANIES`

`NEXT_PUBLIC_APP_URL` should match the public web origin. Auth and dashboard POST routes use it for redirect targets, and they fall back to forwarded host/protocol headers when the app is running behind Docker or a reverse proxy.

## File Locations

- uploaded resumes: `data/uploads/resumes/`
- seeded demo resume: `data/resumes/demo/`
- manual checkpoints: `data/manual_checkpoints/`
- semantic field cache: `data/cache/field-resolution-cache.json`
- seniority cache: `data/cache/job-seniority-cache.json`
- normalized LLM request cache: `data/cache/llm-semantic-cache.json`

## Legacy Python Notes

The Python implementation still matters as reference for:

- Greenhouse safety behavior in `submitter/greenhouse.py`
- form grounding logic in `llm/form_resolver.py`
- source-specific discovery heuristics in `scraper/`

If you intentionally need the legacy runtime, use:

```powershell
docker compose -f docker-compose.legacy-python.yml up --build
```
