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
   - `JobScore`, `TailoredDocument`, and `GeneratedAnswer` are persisted
   - Hard-rule threshold enforcement remains outside the model

6. Playwright applier
   - Greenhouse safety logic has been ported into `packages/automation`
   - Structured profile defaults drive field mapping
   - Prepared payloads and checkpoint artifacts are saved before ambiguous exits
   - Friction paths are marked `needs_user_action`

7. Tracker and notifications
   - `ApplicationEvent` is recorded at worker stages
   - Notifications are created for manual-action cases
   - Resume and reopen capability exists for interrupted applications

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
   - Improve ambiguous-submit detection and application confirmation persistence

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
