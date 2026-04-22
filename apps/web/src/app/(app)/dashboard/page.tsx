import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { describeTrackerState, formatTimestamp, supportsAutofill } from "@/lib/application-presentation";
import { loadDashboardPageData } from "@/lib/page-data";

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const { overview, applications, notifications } = await loadDashboardPageData(user.id);
  const submittedApplications = applications
    .filter((application) => application.status === "auto_submitted" || application.status === "submitted")
    .slice(0, 5);
  const attentionApplications = applications
    .filter((application) => application.status === "needs_user_action")
    .slice(0, 5);
  const readyApplications = applications
    .filter((application) => application.status === "prepared")
    .slice(0, 5);
  const queuedApplications = applications
    .filter((application) => application.status === "queued")
    .slice(0, 5);

  return (
    <AppShell
      title="Overview"
      description="Monitor queue health, submission outcomes, and the exact places where human input is still needed."
      userName={user.fullName ?? user.email}
    >
      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Jobs Found</span>
          <strong>{overview.jobsFound}</strong>
        </article>
        <article className="app-card">
          <span>Above Threshold</span>
          <strong>{overview.aboveThreshold}</strong>
        </article>
        <article className="app-card">
          <span>Prepared</span>
          <strong>{overview.prepared}</strong>
        </article>
        <article className="app-card">
          <span>Queued</span>
          <strong>{overview.queued}</strong>
        </article>
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{overview.submittedTotal}</strong>
        </article>
        <article className="app-card">
          <span>Needs Attention</span>
          <strong>{overview.needsUserAction}</strong>
        </article>
        <article className="app-card">
          <span>24h Target Used</span>
          <strong>{overview.preparedInLast24Hours}/{overview.dailyTargetVolume}</strong>
        </article>
        <article className="app-card">
          <span>24h Slots Left</span>
          <strong>{overview.remainingDailyCapacity}</strong>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Worker</p>
            <h2>Run a pipeline cycle</h2>
          </div>
        </div>
        <p className="app-description">
          Trigger discovery, scoring, tailoring, and apply preparation for your current account. A prepared status means the packet is ready in JobHunter. It does not mean the employer site has been filled yet unless the application later moves to Submitted or Needs Attention.
        </p>
        <p className="app-description">
          The worker enforces your rolling 24-hour target volume before it generates tailored materials. Jobs above the cap stay queued so the best remaining roles are ready for the next open slot instead of burning extra tokens today.
        </p>
        <form action="/api/worker/run" method="post">
          <button type="submit" className="button button-primary">
            Run worker now
          </button>
        </form>
      </section>

      <section className="app-two-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Submitted</p>
              <h2>Actually completed applications</h2>
            </div>
          </div>
          <div className="list-table">
            {submittedApplications.length === 0 ? <div className="list-row"><div><p>No submitted applications yet</p><span>Applications appear here only after a confirmed submit or after you manually mark them submitted.</span></div></div> : null}
            {submittedApplications.map((application) => {
              const state = describeTrackerState(application);
              return (
              <div key={application.id} className="list-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.role}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Job post
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Apply page
                      </a>
                    ) : null}
                  </div>
                </div>
                <div>
                  <p>{state.label}</p>
                  <span>{state.detail}</span>
                </div>
                <div>
                  <p>{application.fitScore}/100</p>
                  <span>{application.source} · {formatTimestamp(application.submittedAt ?? application.updatedAt)}</span>
                </div>
                <div className="row-status">
                  <StatusPill status={application.status} />
                </div>
              </div>
            );
            })}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Needs Attention</p>
              <h2>Finish these next</h2>
            </div>
          </div>
          <div className="stack-list">
            {attentionApplications.length === 0 ? <div className="stack-item"><p>No action required</p><span>The worker has not paused on any application flows.</span></div> : null}
            {attentionApplications.map((application) => {
              const state = describeTrackerState(application);
              return (
              <div key={application.id} className="stack-item">
                <p>{application.company} · {application.role}</p>
                <span>{state.detail}</span>
                  <div className="row-links">
                    {application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                        Resume where paused
                      </a>
                    ) : application.applyUrl ? (
                      <a href={application.applyUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                        Open apply page
                      </a>
                    ) : null}
                  {supportsAutofill(application.applyUrl ?? application.jobUrl) ? (
                    <form action={`/api/applications/${application.id}/autofill`} method="post">
                      <button type="submit" className="button button-primary">
                        Retry autofill
                      </button>
                    </form>
                  ) : null}
                  <form action={`/api/applications/${application.id}/mark-submitted`} method="post">
                    <button type="submit" className="button button-secondary">
                      Mark submitted
                    </button>
                  </form>
                  <form action={`/api/applications/${application.id}/reopen`} method="post">
                    <button type="submit" className="button button-secondary">
                      Reopen
                    </button>
                  </form>
                </div>
              </div>
            );
            })}
          </div>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Ready Next</p>
            <h2>Prepared packets that are not filled on site yet</h2>
          </div>
        </div>
        <div className="list-table">
          {readyApplications.length === 0 ? <div className="list-row"><div><p>No prepared applications yet</p><span>Run the worker after onboarding and resume upload to prepare the next batch.</span></div></div> : null}
          {readyApplications.map((application) => {
            const state = describeTrackerState(application);
            return (
            <div key={application.id} className="list-row">
              <div>
                <p>{application.company}</p>
                <span>{application.role}</span>
              </div>
              <div>
                <p>{state.label}</p>
                <span>{state.detail}</span>
              </div>
              <div className="list-actions">
                {supportsAutofill(application.applyUrl ?? application.jobUrl) ? (
                  <form action={`/api/applications/${application.id}/autofill`} method="post">
                    <button type="submit" className="button button-primary">
                      Autofill now
                    </button>
                  </form>
                ) : null}
                <a href={application.jobUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                  Job post
                </a>
                {application.applyUrl ? (
                  <a href={application.applyUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                    Apply page
                  </a>
                ) : null}
              </div>
              <div className="row-status">
                <StatusPill status={application.status} />
              </div>
            </div>
          );
          })}
        </div>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Queued Next</p>
            <h2>Passed fit rules, waiting for the next daily slot</h2>
          </div>
        </div>
        <div className="list-table">
          {queuedApplications.length === 0 ? <div className="list-row"><div><p>No queued backlog</p><span>Jobs that pass the rules but exceed the rolling 24-hour target will appear here.</span></div></div> : null}
          {queuedApplications.map((application) => {
            const state = describeTrackerState(application);
            return (
            <div key={application.id} className="list-row">
              <div>
                <p>{application.company}</p>
                <span>{application.role}</span>
                <div className="row-links">
                  <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                    Job post
                  </a>
                  {application.applyUrl ? (
                    <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Apply page
                    </a>
                  ) : null}
                </div>
              </div>
              <div>
                <p>{state.label}</p>
                <span>{state.detail}</span>
              </div>
              <div>
                <p>{application.fitScore}/100</p>
                <span>{application.source} · {formatTimestamp(application.updatedAt)}</span>
              </div>
              <div className="row-status">
                <StatusPill status={application.status} />
              </div>
            </div>
          );
          })}
        </div>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Recent Alerts</p>
            <h2>Notifications</h2>
          </div>
        </div>
        <div className="stack-list">
          {notifications.length === 0 ? <div className="stack-item"><p>No notifications</p><span>The worker has not produced any alerts yet.</span></div> : null}
          {notifications.map((notification) => (
            <div key={notification.id} className="stack-item">
              <p>{notification.title}</p>
              <span>{notification.message}</span>
              <form action={`/api/notifications/${notification.id}/read`} method="post">
                <button type="submit" className="button button-secondary">
                  Mark read
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
