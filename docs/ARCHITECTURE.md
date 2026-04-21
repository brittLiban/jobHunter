# Architecture

## Goal

JobHunter is being reshaped from a local Python pipeline into a full-stack SaaS app with clear service boundaries:

- finder: ingest supported job sources
- brain: score fit, tailor resume content, generate short answers
- applier: fill and submit predictable forms with Playwright
- tracker: persist status, history, and required user actions

The core safety rule is unchanged:

> Auto-submit only when the flow is simple and confidence is high. Pause immediately when friction or uncertainty appears.

## Repository Structure

```text
apps/
  web/        Next.js product surface
  worker/     background processing entry point

packages/
  core/       shared domain types and rules
  db/         Prisma schema, migrations, seed
  llm/        scorer, resume tailor, short-answer generator
  automation/ Playwright checkpoint and submit-planning layer
  job-sources adapter layer for ingestion
```

## Service Responsibilities

### `apps/web`

Current role:

- marketing site
- authenticated app shell routes
- API placeholders for health and demo bootstrap

Target role:

- auth
- onboarding
- dashboard queries
- resume management
- notifications
- user action resume flows

### `apps/worker`

Current role:

- proof-of-shape worker that runs mock ingestion, scoring, tailoring, and submit planning

Target role:

- scheduled ingestion
- job dedupe
- threshold filtering
- persistence of scores, tailored docs, and generated answers
- Playwright automation orchestration
- checkpoint capture and status transitions

### `packages/core`

This package defines shared product rules that should not drift across services:

- application statuses
- manual action types
- source kinds
- structured profile fields
- fit threshold helpers
- auto-submit decision helper
- anti-repetition tracker

This package is where the product contract lives.

### `packages/db`

This package owns:

- Prisma schema
- Prisma config for current Prisma 7 CLI behavior
- initial SQL migration
- demo seed data

Main tables/models:

- users and auth-linked records
- structured user profile
- preferences
- resumes and resume versions
- job sources and jobs
- job scores
- tailored documents
- generated answers
- applications and application events
- notifications
- prompt templates

### `packages/llm`

The LLM layer is intentionally modular:

- `JobScorerService`
- `ResumeTailorService`
- `ShortAnswerGeneratorService`

Current implementation uses a fallback provider so the architecture is stable before wiring a live model provider.

Important constraint:

- hard threshold and business rules remain outside the model
- structured profile facts are not delegated to the model
- generated text must remain truthful and grounded

### `packages/automation`

This package contains the automation policy seam:

- detect known manual checkpoints
- decide whether an application should remain prepared or auto-submit

This is where the Python Greenhouse safety behavior will be ported next.

### `packages/job-sources`

Current state:

- mock adapter only

Target state:

- Greenhouse
- Ashby
- Lever
- Workable
- company-site sources where practical

Each source should normalize into the same job posting contract before scoring begins.

## Status Flow

Current shared status lifecycle:

1. `discovered`
2. `scored`
3. `queued`
4. `prepared`
5. `auto_submitted` or `needs_user_action`
6. `submitted`
7. `responded`
8. `interview`
9. `rejected` or `offer`

The worker should only move an application into `auto_submitted` when:

- threshold rules passed
- the flow is simple and predictable
- there is no checkpoint
- confidence is high enough

The worker must move an application into `needs_user_action` when:

- CAPTCHA appears
- verification code is required
- upload fails
- the form structure is unusual
- required data is missing
- submit state is ambiguous

## Data Boundaries

### Structured user profile

These values are owned by the user profile and should directly power autofill:

- legal name
- email
- phone
- location facts
- LinkedIn, GitHub, portfolio
- work authorization and sponsorship facts
- veteran and disability values when provided
- education details
- experience years
- current company and title

These are not LLM-generated.

### LLM-generated content

The model can generate:

- fit explanation
- tailored summary and bullets
- short application answers

The model must not invent experience or replace structured profile facts.

## Legacy Python Layer

The old Python code remains because it already contains practical behavior worth porting:

- `submitter/greenhouse.py` has the best current checkpoint and fail-closed behavior
- `llm/form_resolver.py` has grounding ideas worth carrying forward
- discovery modules already show the target source mix

That code is now reference implementation, not the primary app surface.

## Immediate Next Engineering Steps

1. Add real auth and onboarding flows in `apps/web`
2. Replace demo fixtures with Prisma-backed reads
3. Persist worker results into Postgres
4. Add file-backed resume uploads and tailored resume versions
5. Port Greenhouse Playwright logic into `packages/automation`
6. Add notifications and resume/reopen actions for blocked applications
