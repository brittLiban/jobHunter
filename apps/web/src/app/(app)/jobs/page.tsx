import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import {
  describeTrackerState,
  formatTimestamp,
  getAutofillActionSummary,
  supportsAutofill,
} from "@/lib/application-presentation";
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
      description="Every tracked job shows both fit and the next real action: skip, queue, open and autofill, or finish manually."
      userName={user.fullName ?? user.email}
      currentPath="/jobs"
    >
      <section className="app-notice app-notice-info">
        <p className="notice-title">What this page shows</p>
        <p className="notice-body">
          Jobs are the discovery view. When a role is worth acting on, use the application actions here or jump into the application queue for more detail.
        </p>
      </section>

      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Tracked Jobs</span>
          <strong>{jobs.length}</strong>
        </article>
        <article className="app-card">
          <span>Ready to Open</span>
          <strong>{preparedCount}</strong>
        </article>
        <article className="app-card">
          <span>Queued Next</span>
          <strong>{queuedCount}</strong>
        </article>
        <article className="app-card">
          <span>Needs You</span>
          <strong>{needsAttentionCount}</strong>
        </article>
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{submittedCount}</strong>
        </article>
      </section>

      <section className="app-card app-action-hero">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Action Labels</p>
            <h2>Choose the right path from the job list</h2>
          </div>
        </div>
        <div className="action-guide-grid">
          <div className="stack-item">
            <p>View job</p>
            <span>Open the original posting and review the description or source context.</span>
          </div>
          <div className="stack-item">
            <p>Open raw page</p>
            <span>Open the employer application without triggering automation.</span>
          </div>
          <div className="stack-item">
            <p>Open and autofill</p>
            <span>Trigger the prepared packet on supported application flows.</span>
          </div>
        </div>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Tracked Jobs</p>
            <h2>Discovery to submission in one list</h2>
          </div>
        </div>
        <div className="list-table">
          {jobs.length === 0 ? (
            <div className="list-row">
              <div>
                <p>No jobs yet</p>
                <span>Run the worker after onboarding and uploading a resume.</span>
              </div>
            </div>
          ) : null}
          {jobs.map((job) => {
            const targetUrl = job.applyUrl ?? job.url;
            const canAutofill = Boolean(
              job.applicationId
              && ["prepared", "needs_user_action"].includes(job.status)
              && supportsAutofill(targetUrl),
            );
            const autofill = getAutofillActionSummary({
              status: job.status,
              targetUrl,
            });
            const state = describeTrackerState({
              status: job.status,
              blockingReason: job.blockingReason,
              preparedPayload: job.preparedPayload,
              submittedAt: job.submittedAt,
              needsUserActionAt: job.needsUserActionAt,
              updatedAt: job.applicationUpdatedAt ?? job.discoveredAt,
            });

            return (
              <div key={job.id} className="list-row list-row-rich">
                <div>
                  <p>{job.title}</p>
                  <span>{job.company}</span>
                  <div className="row-links">
                    <a href={job.url} className="inline-link" target="_blank" rel="noreferrer">
                      View job
                    </a>
                    {job.applyUrl ? (
                      <a href={job.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open raw page
                      </a>
                    ) : null}
                    {job.lastAutomationUrl ? (
                      <a href={job.lastAutomationUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Resume paused step
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
                  <span>
                    {job.fitScore !== null
                      ? `Fit ${job.fitScore}/100 - ${formatTimestamp(job.applicationUpdatedAt ?? job.discoveredAt)}`
                      : `Discovered ${formatTimestamp(job.discoveredAt)}`}
                  </span>
                </div>
                <div className="list-actions">
                  {canAutofill && job.applicationId ? (
                    <form action={`/api/applications/${job.applicationId}/autofill`} method="post">
                      <button type="submit" className="button button-primary">
                        {autofill.label}
                      </button>
                    </form>
                  ) : null}
                  {job.applicationId ? (
                    <a href="/applications" className="button button-secondary">
                      Open queue
                    </a>
                  ) : null}
                </div>
                <div className="row-status">
                  <StatusPill status={(job.status as Parameters<typeof StatusPill>[0]["status"]) ?? "discovered"} />
                </div>
                <p className="row-help row-help-wide">
                  {canAutofill ? autofill.hint : "This row shows discovery and queue state. Use the raw page when you want the employer site without running autofill."}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
