# TODO

## Completed Checkpoints

1. Auth and onboarding
   - Credential signup/login/logout flow added
   - Onboarding completion persisted on `User`
   - Structured profile and preferences form backed by `UserProfile` and `UserPreference`

2. Resume management
   - Resume upload storage strategy added under `data/uploads/resumes`
   - `ResumeVersion` records are created for tailored outputs
   - Resume management page now reads real Prisma data

3. Real data flow
   - Demo snapshot rendering was replaced with Prisma-backed dashboard queries
   - Demo seed is optional and gated behind `JOBHUNTER_ENABLE_DEMO_SEED`
   - Typed API contracts now exist for auth, jobs, applications, profile, notifications, and resumes

4. Job ingestion
   - `packages/job-sources` now exposes a shared adapter contract
   - Greenhouse, Ashby, Lever, and Workable adapters are implemented alongside Mock
   - Worker performs normalized discovery and URL-based dedupe before persistence

5. Scoring and tailoring
   - Modular LLM provider layer added with OpenAI, Ollama, and mock fallback paths
   - Job seniority is now classified on ingest and persisted as `entry`, `mid`, or `senior`
   - `JobScore`, `TailoredDocument`, and `GeneratedAnswer` are persisted
   - Hard-rule threshold enforcement remains outside the model
   - Normalized request caching now reduces repeat token spend for seniority, scoring, tailoring, and short-answer generation

6. Playwright applier
   - Greenhouse safety logic has been ported into `packages/automation`
   - Hosted Greenhouse employer pages such as Stripe now resolve into the embedded application iframe instead of failing on the listing shell
   - Structured profile defaults drive field mapping
   - Prepared payloads and checkpoint artifacts are saved before ambiguous exits
   - Friction paths are marked `needs_user_action`

7. Tracker and notifications
   - `ApplicationEvent` is recorded at worker stages
   - Notifications are created for manual-action cases
   - Resume and reopen capability exists for interrupted applications
   - The queue UI now uses explicit action labels like `Open browser autofill`, `Run live autofill`, `Open application only`, and `Open paused page`
   - Local mock autofill now opens the actual mock application page, fills it in-browser, and records completion back into the tracker
   - Dashboard, jobs, and application views were regrouped around `Ready to run`, `Needs attention`, and `Submitted` so the next action is obvious
   - Jobs and applications now support search, status filtering, and a `Greater Seattle Area` location preset
   - Discovery controls now gate persistence by source, seniority, location, and include/exclude keyword rules so off-target jobs do not enter the queue
   - Needs-attention rows now show how many fields were autofilled and which required questions still need the user
   - Queue users can now save unresolved required answers per application and reuse them on the next live autofill retry
   - Needs-attention rows now preload conservative LLM suggestions for unresolved required answers when confidence is high
   - Greenhouse submit detection now covers broader submit/apply control patterns to reduce false ambiguous pauses

## Remaining Work

1. Auth hardening
   - Add OAuth providers if needed
   - Add password reset and stronger account-recovery flows
   - Add CSRF/rate-limit hardening around auth routes

2. Worker orchestration
   - Add scheduled execution and queue-backed background processing
   - Daily volume limits are now enforced in the worker loop with queued overflow and rolling 24-hour capacity tracking
   - Add backoff and retry policy for flaky source syncs and automation retries

3. Automation coverage
   - Expand Playwright automation beyond Greenhouse
   - Deepen radio/select/file mapping coverage for non-standard forms
   - Expand submit/confirmation detection coverage for additional ATS systems beyond current Greenhouse heuristics

4. Product polish
   - Add richer dashboard analytics and outcome tracking
   - Add more complete notification actions and user guidance surfaces
   - Add screenshots/placeholders or real product imagery to the landing page

5. Extension readiness
   - Formalize backend APIs for future extension consumption
   - Add token-based machine access paths separate from browser sessions

6. Quality
   - Add integration tests for auth, onboarding, worker persistence, and automation checkpoints
   - Add structured logging and operational metrics for web and worker services
