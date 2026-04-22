# Architecture

## Goal

JobHunter is being reshaped from a local Python pipeline into a full-stack SaaS app with clear service boundaries:

- finder: ingest supported job sources
- brain: score fit, tailor resume content, generate short answers
- applier: fill and submit predictable forms with Playwright
- tracker: persist status, history, and required user actions

The core safety rule remains:

> Auto-submit only when the flow is simple and confidence is high. Pause immediately when friction or uncertainty appears.

## Repository Structure

```text
apps/
  web/        Next.js marketing site, authenticated app, and API routes
  worker/     background worker entry point

packages/
  core/       shared product rules, API contracts, and autofill helpers
  db/         Prisma schema, migrations, queries, pipeline persistence, and demo seed
  llm/        scorer, resume tailor, and short-answer generator services
  automation/ Playwright apply logic and checkpoint capture
  job-sources source adapters for supported job feeds
```

## Current Service Responsibilities

### `apps/web`

Current responsibilities:

- marketing site
- credential auth routes
- onboarding and profile editing
- resume upload handling
- dashboard, jobs, applications, and notification surfaces
- worker-trigger API route for authenticated users

### `apps/worker`

Current responsibilities:

- discover jobs from configured adapters
- persist job sources and discovered jobs
- apply hard business rules and fit scoring
- tailor resume content and generate short answers
- prepare applications and tracker records
- attempt safe autofill for local mock pages and Greenhouse flows
- preserve submitted and paused application states across worker reruns
- skip users who are not onboarded or do not yet have a default resume

### `packages/core`

Owns the cross-service product contract:

- statuses
- manual action types
- source kinds
- structured profile schema
- onboarding and resume API schemas
- rule evaluation helpers
- structured autofill defaults
- anti-repetition helpers

### `packages/db`

Owns:

- Prisma schema and migrations
- Prisma client creation
- auth/session persistence
- user workspace queries
- worker persistence helpers
- demo seed data

Primary models:

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

### `packages/llm`

The LLM layer is modular by task:

- `JobScorerService`
- `ResumeTailorService`
- `ShortAnswerGeneratorService`
- `ApplicationFieldResolverService`

Provider support:

- OpenAI via `OPENAI_API_KEY`
- Ollama via `OLLAMA_URL`
- mock fallback when no provider is configured

Hard rules remain outside the model, and structured profile facts are never delegated to the model.

### `packages/automation`

Current automation responsibilities:

- Greenhouse and local mock apply flows
- structured field mapping
- LLM-assisted fallback field resolution
- semantic field-resolution cache
- checkpoint detection
- checkpoint artifact capture
- fail-closed submit behavior

When automation cannot proceed safely, it persists prepared payloads and returns control to the tracker as `needs_user_action`.

### `packages/job-sources`

Current adapters:

- Mock
- Greenhouse
- Ashby
- Lever
- Workable

Every adapter normalizes into the shared `JobPosting` contract before scoring begins.

## Status Flow

Primary lifecycle:

1. `discovered`
2. `scored`
3. `skipped` or `queued`
4. `prepared`
5. `auto_submitted` or `needs_user_action`
6. `submitted`
7. `responded`
8. `interview`
9. `rejected` or `offer`

The worker may only move an application into `auto_submitted` when:

- hard rules passed
- fit threshold passed
- confidence is high
- the flow is simple and predictable
- no manual checkpoint is detected
- live auto-apply is explicitly enabled

The worker must move an application into `needs_user_action` when:

- CAPTCHA appears
- verification code is required
- upload fails
- the form structure is unusual
- required data is missing
- submit state is ambiguous

## Data Boundaries

### Structured user profile

These facts come directly from saved profile data and power autofill:

- legal name
- email
- phone
- city, state, country
- LinkedIn, GitHub, portfolio
- work authorization and sponsorship facts
- veteran and disability values when provided
- school, degree, graduation date
- years of experience
- current company and title

These are not LLM-generated.

### LLM-generated content

The model can generate:

- fit explanations
- tailored summary and bullets
- short application answers

The model must not invent experience or replace structured profile facts.

## Runtime Storage

The current v1 runtime uses the database for structured state and the local filesystem for file artifacts.

Primary filesystem paths:

- uploaded resumes: `data/uploads/resumes/`
- seeded demo resume: `data/resumes/demo/`
- automation checkpoints: `data/manual_checkpoints/<applicationId>/`
- semantic field cache: `data/cache/field-resolution-cache.json`

This keeps v1 simple while still preserving enough information for human-in-the-loop resume flows.

## Legacy Python Layer

The old Python code remains as reference implementation for:

- Greenhouse checkpoint behavior in `submitter/greenhouse.py`
- grounding logic in `llm/form_resolver.py`
- source-specific discovery patterns in `scraper/`

It is no longer the primary runtime path.

## Next Architecture Steps

1. Add queue-backed orchestration and scheduling around the worker
2. Expand automation coverage beyond Greenhouse and the local mock verifier
3. Harden auth for production use cases
4. Add better observability and integration testing
5. Formalize extension-oriented backend APIs
