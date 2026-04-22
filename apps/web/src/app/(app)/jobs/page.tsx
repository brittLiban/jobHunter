import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { describeTrackerState, formatTimestamp, supportsAutofill } from "@/lib/application-presentation";
import { loadJobsPageData } from "@/lib/page-data";

export default async function JobsPage() {
  const user = await requireOnboardedUser();
  const jobs = await loadJobsPageData(user.id);
  const submittedCount = jobs.filter((job) => job.status === "auto_submitted" || job.status === "submitted").length;
  const needsAttentionCount = jobs.filter((job) => job.status === "needs_user_action").length;
  const preparedCount = jobs.filter((job) => job.status === "prepared").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;

  return (
    <AppShell
      title="Jobs Found"
      description="Review discovered roles, fit scores, source coverage, and which jobs have moved into the application queue."
      userName={user.fullName ?? user.email}
    >
      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Tracked Jobs</span>
          <strong>{jobs.length}</strong>
        </article>
        <article className="app-card">
          <span>Prepared</span>
          <strong>{preparedCount}</strong>
        </article>
        <article className="app-card">
          <span>Queued</span>
          <strong>{queuedCount}</strong>
        </article>
        <article className="app-card">
          <span>Needs Attention</span>
          <strong>{needsAttentionCount}</strong>
        </article>
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{submittedCount}</strong>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Source Coverage</p>
            <h2>Tracked jobs</h2>
          </div>
        </div>
        <div className="list-table">
          {jobs.length === 0 ? <div className="list-row"><div><p>No jobs yet</p><span>Run the worker after onboarding and uploading a resume.</span></div></div> : null}
          {jobs.map((job) => {
            const canAutofill = Boolean(
              job.applicationId
              && ["prepared", "needs_user_action"].includes(job.status)
              && supportsAutofill(job.applyUrl ?? job.url),
            );
            const state = describeTrackerState({
              status: job.status,
              blockingReason: job.blockingReason,
              preparedPayload: job.preparedPayload,
              submittedAt: job.submittedAt,
              needsUserActionAt: job.needsUserActionAt,
              updatedAt: job.applicationUpdatedAt ?? job.discoveredAt,
            });
            return (
            <div key={job.id} className="list-row">
              <div>
                <p>{job.title}</p>
                <span>{job.company}</span>
                <div className="row-links">
                  <a href={job.url} className="inline-link" target="_blank" rel="noreferrer">
                    Job post
                  </a>
                  {job.applyUrl ? (
                    <a href={job.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Apply page
                    </a>
                  ) : null}
                  {job.lastAutomationUrl ? (
                    <a href={job.lastAutomationUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Resume saved flow
                    </a>
                  ) : null}
                </div>
              </div>
              <div>
                <p>{state.label}</p>
                <span>{state.detail}</span>
              </div>
              <div>
                <p>{job.sourceName}</p>
                <span>{job.fitScore !== null ? `Fit ${job.fitScore}/100` : "Unscored"} · {formatTimestamp(job.applicationUpdatedAt ?? job.discoveredAt)}</span>
              </div>
              <div className="list-actions">
                {canAutofill ? (
                  <form action={`/api/applications/${job.applicationId}/autofill`} method="post">
                    <button type="submit" className="button button-primary">
                      {job.status === "needs_user_action" ? "Retry autofill" : "Autofill now"}
                    </button>
                  </form>
                ) : null}
              </div>
              <div className="row-status">
                <StatusPill status={(job.status as Parameters<typeof StatusPill>[0]["status"]) ?? "discovered"} />
              </div>
            </div>
          );
          })}
        </div>
      </section>
    </AppShell>
  );
}
