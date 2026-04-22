import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { describeTrackerState, formatTimestamp, supportsAutofill } from "@/lib/application-presentation";
import { loadApplicationsPageData } from "@/lib/page-data";

const guardrails = [
  "Auto-submit only when the form flow is simple and predictable.",
  "Pause immediately on CAPTCHA, verification codes, upload failures, or unusual structure.",
  "Preserve prepared answers, selected fields, and resume context for quick manual completion.",
  "Never bypass security protections or guess unknown required answers.",
] as const;

const statusGuide = [
  "queued: job passed thresholding and is waiting for the next preparation or automation attempt",
  "prepared: the packet is ready inside JobHunter, but the employer site is not necessarily filled yet",
  "needs_user_action: the worker reached the site, saved its state, and paused because a human was needed",
  "auto_submitted: automation detected a clear confirmation state and completed the submission itself",
  "submitted: the application is complete because you marked a manual finish or another submit path confirmed it",
] as const;

export default async function ApplicationsPage() {
  const user = await requireOnboardedUser();
  const applications = await loadApplicationsPageData(user.id);
  const submittedCount = applications.filter((application) => application.status === "auto_submitted" || application.status === "submitted").length;
  const needsAttentionCount = applications.filter((application) => application.status === "needs_user_action").length;
  const preparedCount = applications.filter((application) => application.status === "prepared").length;

  return (
    <AppShell
      title="Applications"
      description="Prepared packets, autonomous submissions, and manual checkpoints live in one queue with explicit status history."
      userName={user.fullName ?? user.email}
    >
      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{submittedCount}</strong>
        </article>
        <article className="app-card">
          <span>Needs Attention</span>
          <strong>{needsAttentionCount}</strong>
        </article>
        <article className="app-card">
          <span>Prepared, Not Filled Yet</span>
          <strong>{preparedCount}</strong>
        </article>
      </section>

      <section className="app-two-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Current applications</h2>
            </div>
          </div>
          <div className="list-table">
            {applications.length === 0 ? (
              <div className="list-row">
                <div>
                  <p>No applications yet</p>
                  <span>The worker has not prepared any job applications.</span>
                </div>
              </div>
            ) : null}
            {applications.map((application) => {
              const state = describeTrackerState(application);
              const canMarkSubmitted = !["auto_submitted", "submitted", "skipped", "rejected", "offer"].includes(application.status);
              const canAutofill = ["prepared", "needs_user_action"].includes(application.status)
                && supportsAutofill(application.applyUrl ?? application.jobUrl);
              return (
              <div key={application.id} className="list-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.title}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Job post
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Apply page
                      </a>
                    ) : null}
                    {application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Saved resume point
                      </a>
                    ) : null}
                  </div>
                </div>
                <div>
                  <p>{state.label}</p>
                  <span>{state.detail}</span>
                </div>
                <div>
                  <p>{application.generatedAnswers.length} answers</p>
                  <span>{application.fitScore !== null ? `${application.fitScore}/100 fit · ${formatTimestamp(application.updatedAt)}` : `Unscored · ${formatTimestamp(application.updatedAt)}`}</span>
                </div>
                <div className="row-status">
                  <StatusPill status={application.status as Parameters<typeof StatusPill>[0]["status"]} />
                </div>
                <div className="list-actions">
                  {canAutofill ? (
                    <form action={`/api/applications/${application.id}/autofill`} method="post">
                      <button type="submit" className="button button-primary">
                        {application.status === "needs_user_action" ? "Retry autofill" : "Autofill now"}
                      </button>
                    </form>
                  ) : null}
                  {application.status === "needs_user_action" && application.lastAutomationUrl ? (
                    <a href={application.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                      Resume
                    </a>
                  ) : null}
                  {canMarkSubmitted ? (
                    <form action={`/api/applications/${application.id}/mark-submitted`} method="post">
                      <button type="submit" className="button button-secondary">
                        Mark submitted
                      </button>
                    </form>
                  ) : null}
                  {application.status === "needs_user_action" ? (
                    <form action={`/api/applications/${application.id}/reopen`} method="post">
                      <button type="submit" className="button button-secondary">
                        Reopen
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
            })}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Safety Rules</p>
              <h2>Human-in-the-loop guardrails</h2>
            </div>
          </div>
          <ul className="flat-list">
            {guardrails.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Event History</p>
            <h2>Latest lifecycle events</h2>
          </div>
        </div>
        <div className="stack-list">
          {applications.flatMap((application) =>
            application.events.slice(0, 1).map((event) => (
              <div key={event.id} className="stack-item">
                <p>{application.company} · {event.title}</p>
                <span>{event.detail ?? event.type} · {formatTimestamp(event.createdAt)}</span>
              </div>
            )),
          )}
        </div>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Status Guide</p>
            <h2>What these states mean</h2>
          </div>
        </div>
        <ul className="flat-list">
          {statusGuide.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
