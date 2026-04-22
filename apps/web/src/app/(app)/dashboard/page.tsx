import { AppShell } from "@/components/app-shell";
import { AutofillLaunchForm } from "@/components/autofill-launch-form";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import {
  describeTrackerState,
  formatTimestamp,
  getAutofillActionSummary,
  supportsAutofill,
} from "@/lib/application-presentation";
import { loadDashboardPageData } from "@/lib/page-data";

type DashboardPageNotice = {
  tone: "success" | "info";
  title: string;
  message: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string; notification?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const notice = buildDashboardNotice(params);
  const { overview, applications, notifications } = await loadDashboardPageData(user.id);
  const submittedApplications = applications
    .filter((application) => application.status === "auto_submitted" || application.status === "submitted")
    .slice(0, 4);
  const attentionApplications = applications
    .filter((application) => application.status === "needs_user_action")
    .slice(0, 4);
  const readyApplications = applications
    .filter((application) => application.status === "prepared")
    .slice(0, 4);
  const queuedApplications = applications
    .filter((application) => application.status === "queued")
    .slice(0, 4);

  return (
    <AppShell
      title="Overview"
      description="Run discovery, review the queue, and see immediately what was submitted versus what still needs you."
      userName={user.fullName ?? user.email}
      currentPath="/dashboard"
    >
      {notice ? (
        <section className={`app-notice app-notice-${notice.tone}`}>
          <div>
            <p className="notice-title">{notice.title}</p>
            <p className="notice-body">{notice.message}</p>
          </div>
        </section>
      ) : null}

      <section className="app-toolbar app-card">
        <div>
          <p className="eyebrow">Control Center</p>
          <h2>Operate the queue from one place</h2>
          <p className="section-copy">
            Local mock jobs use visible browser autofill. Live Greenhouse jobs run through Playwright and reopen the page they reached after automation finishes.
          </p>
        </div>
        <div className="toolbar-actions">
          <form action="/api/worker/run" method="post">
            <button type="submit" className="button button-primary">
              Run worker now
            </button>
          </form>
          <a href="/jobs?locationPreset=greater_seattle" className="button button-secondary">
            Seattle discovery
          </a>
          <a href="/applications" className="button button-secondary">
            Open review queue
          </a>
        </div>
      </section>

      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Matched jobs</span>
          <strong>{overview.jobsFound}</strong>
        </article>
        <article className="app-card">
          <span>Above threshold</span>
          <strong>{overview.aboveThreshold}</strong>
        </article>
        <article className="app-card">
          <span>Ready to run</span>
          <strong>{overview.prepared}</strong>
        </article>
        <article className="app-card">
          <span>Needs attention</span>
          <strong>{overview.needsUserAction}</strong>
        </article>
        <article className="app-card">
          <span>Submitted</span>
          <strong>{overview.submittedTotal}</strong>
        </article>
        <article className="app-card">
          <span>24h prepared</span>
          <strong>{overview.preparedInLast24Hours}/{overview.dailyTargetVolume}</strong>
        </article>
      </section>

      <section className="panel-grid-two">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Needs Attention</p>
              <h2>Finish these first</h2>
            </div>
            <a href="/applications?status=needs_user_action" className="inline-link">
              View all
            </a>
          </div>
          <div className="summary-list">
            {attentionApplications.length === 0 ? (
              <div className="summary-item">
                <p>No application is blocked right now</p>
                <span>The queue is clear until a site hits friction or a manual step.</span>
              </div>
            ) : null}
            {attentionApplications.map((application) => {
              const targetUrl = application.applyUrl ?? application.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl,
              });
              const state = describeTrackerState(application);

              return (
                <div key={application.id} className="summary-item">
                  <div className="summary-item-header">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.role}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <div className="meta-badges">
                    <span className="meta-badge">{application.source}</span>
                    <span className="meta-badge">{autofill.modeLabel}</span>
                    <span className="meta-badge">Fit {application.fitScore}</span>
                  </div>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View posting
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open application only
                      </a>
                    ) : null}
                    {application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Resume paused step
                      </a>
                    ) : null}
                  </div>
                  <div className="list-actions">
                    {canAutofill ? (
                      <AutofillLaunchForm applicationId={application.id} label={autofill.label} />
                    ) : null}
                    <form action={`/api/applications/${application.id}/mark-submitted`} method="post">
                      <button type="submit" className="button button-secondary">
                        Mark submitted
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Ready To Run</p>
              <h2>Prepared packets</h2>
            </div>
            <a href="/applications?status=prepared" className="inline-link">
              View all
            </a>
          </div>
          <div className="summary-list">
            {readyApplications.length === 0 ? (
              <div className="summary-item">
                <p>No prepared applications yet</p>
                <span>Run the worker after onboarding and resume upload to prepare the next batch.</span>
              </div>
            ) : null}
            {readyApplications.map((application) => {
              const targetUrl = application.applyUrl ?? application.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl,
              });
              const state = describeTrackerState(application);

              return (
                <div key={application.id} className="summary-item">
                  <div className="summary-item-header">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.role}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <div className="meta-badges">
                    <span className="meta-badge">{application.source}</span>
                    <span className="meta-badge">{autofill.modeLabel}</span>
                    <span className="meta-badge">Fit {application.fitScore}</span>
                  </div>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View posting
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open application only
                      </a>
                    ) : null}
                  </div>
                  <div className="list-actions">
                    {canAutofill ? (
                      <AutofillLaunchForm applicationId={application.id} label={autofill.label} />
                    ) : null}
                    <a href="/applications" className="button button-secondary">
                      Open full queue
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="panel-grid-two">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Submitted</p>
              <h2>Recently confirmed</h2>
            </div>
            <a href="/applications?status=submitted" className="inline-link">
              View all
            </a>
          </div>
          <div className="summary-list">
            {submittedApplications.length === 0 ? (
              <div className="summary-item">
                <p>No confirmed submissions yet</p>
                <span>Applications only move here after a real confirmation state or a manual confirmation.</span>
              </div>
            ) : null}
            {submittedApplications.map((application) => (
              <div key={application.id} className="summary-item">
                <div className="summary-item-header">
                  <div>
                    <p>{application.company}</p>
                    <span>{application.role}</span>
                  </div>
                  <StatusPill status={application.status} />
                </div>
                <div className="meta-badges">
                  <span className="meta-badge">{application.source}</span>
                  <span className="meta-badge">Fit {application.fitScore}</span>
                </div>
                <span>{describeTrackerState(application).detail}</span>
                <div className="row-links">
                  <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                    View posting
                  </a>
                  {application.applyUrl ? (
                    <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                      Open application
                    </a>
                  ) : null}
                </div>
                <p className="row-help">
                  Submitted {formatTimestamp(application.submittedAt ?? application.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Queue Health</p>
              <h2>Queued work and alerts</h2>
            </div>
          </div>
          <div className="summary-list">
            <div className="summary-item">
              <p>Queued next</p>
              <span>{queuedApplications.length === 0 ? "No backlog is waiting on a daily slot." : `${queuedApplications.length} applications are waiting for the next preparation slot.`}</span>
              {queuedApplications.length > 0 ? (
                <a href="/applications?status=queued" className="inline-link">
                  Open queued applications
                </a>
              ) : null}
            </div>
            {notifications.length === 0 ? (
              <div className="summary-item">
                <p>No recent alerts</p>
                <span>The worker has not produced any unread notifications.</span>
              </div>
            ) : null}
            {notifications.slice(0, 3).map((notification) => (
              <div key={notification.id} className="summary-item">
                <p>{notification.title}</p>
                <span>{notification.message}</span>
                <p className="row-help">{formatTimestamp(notification.createdAt)}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AppShell>
  );
}

function buildDashboardNotice(params: {
  worker?: string;
  notification?: string;
}): DashboardPageNotice | null {
  if (params.worker === "ran") {
    return {
      tone: "success",
      title: "Worker cycle started",
      message: "Discovery, scoring, tailoring, and preparation were triggered for your current account.",
    };
  }

  if (params.notification === "read") {
    return {
      tone: "info",
      title: "Notification updated",
      message: "The alert was marked read and removed from your unread queue.",
    };
  }

  return null;
}
