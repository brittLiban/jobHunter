# TODO

## Next Checkpoints

1. Auth and onboarding
   - Add credential or OAuth auth flow
   - Persist onboarding completion on `User`
   - Build structured profile form backed by `UserProfile` and `UserPreference`

2. Resume management
   - Add file upload storage strategy for `Resume`
   - Generate `ResumeVersion` records for tailored outputs
   - Connect dashboard pages to real resume data

3. Real data flow
   - Replace demo snapshot rendering in `apps/web` with Prisma-backed queries
   - Seed only for demo mode, not as the main runtime path
   - Add API contracts for jobs, applications, profile, and notifications

4. Job ingestion
   - Keep `packages/job-sources` adapter contract
   - Implement Greenhouse, Ashby, Lever, and Workable adapters behind the same interface
   - Add source scheduling and dedupe rules in the worker

5. Scoring and tailoring
   - Replace fallback heuristics with a real LLM provider interface
   - Persist `JobScore`, `TailoredDocument`, and `GeneratedAnswer`
   - Add hard-rule threshold enforcement outside the model

6. Playwright applier
   - Port the proven Greenhouse safety logic from the Python submitter
   - Add field mapping from structured profile data
   - Save prepared payloads before every submit attempt
   - Mark applications `needs_user_action` on friction

7. Tracker and notifications
   - Persist `ApplicationEvent` at each pipeline stage
   - Notify users when manual action is required
   - Add resume and reopen capability for interrupted flows
