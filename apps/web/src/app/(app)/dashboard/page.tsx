import { AppShell } from "@/components/app-shell";
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
      description="The dashboard is organized around the next decision: done, ready to open, or waiting on you."
      userName={user.fullName ?? user.email}
      currentPath="/dashboard"
    >
      {notice ? (
        <section className={`app-notice app-notice-${notice.tone}`}>
          <p className="notice-title">{notice.title}</p>
          <p className="notice-body">{notice.message}</p>
        </section>
      ) : null}

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
          <span>Ready to Open</span>
          <strong>{overview.prepared}</strong>
        </article>
        <article className="app-card">
          <span>Needs You</span>
          <strong>{overview.needsUserAction}</strong>
        </article>
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{overview.submittedTotal}</strong>
        </article>
        <article className="app-card">
          <span>Queued Next</span>
          <strong>{overview.queued}</strong>
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

      <section className="app-card app-action-hero">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Control Center</p>
            <h2>Use the queue the same way every time</h2>
          </div>
          <div className="list-actions">
            <form action="/api/worker/run" method="post">
              <button type="submit" className="button button-primary">
                Run worker now
              </button>
            </form>
            <a href="/applications" className="button button-secondary">
              Open application queue
            </a>
          </div>
        </div>
        <div className="action-guide-grid">
          <div className="stack-item">
            <p>1. Run worker</p>
            <span>Discovery, scoring, tailoring, and preparation happen here.</span>
          </div>
          <div className="stack-item">
            <p>2. Open and autofill</p>
            <span>Supported mock flows open the application page and visibly fill it in-browser.</span>
          </div>
          <div className="stack-item">
            <p>3. Finish only when needed</p>
            <span>CAPTCHAs, codes, selector failures, and missing answers move the job into Needs You.</span>
          </div>
        </div>
      </section>

      <section className="app-three-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Needs You</p>
              <h2>Finish these next</h2>
            </div>
          </div>
          <div className="stack-list">
            {attentionApplications.length === 0 ? (
              <div className="stack-item">
                <p>No action required</p>
                <span>The worker has not paused on any application flows.</span>
              </div>
            ) : null}
            {attentionApplications.map((application) => {
              const state = describeTrackerState(application);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl: application.applyUrl ?? application.jobUrl,
              });
              const canAutofill = supportsAutofill(application.applyUrl ?? application.jobUrl);
              return (
                <div key={application.id} className="stack-item">
                  <div className="stack-item-top">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.role}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View job
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open raw page
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
                      <form action={`/api/applications/${application.id}/autofill`} method="post">
                        <button type="submit" className="button button-primary">
                          {autofill.label}
                        </button>
                      </form>
                    ) : null}
                    <form action={`/api/applications/${application.id}/mark-submitted`} method="post">
                      <button type="submit" className="button button-secondary">
                        Mark submitted
                      </button>
                    </form>
                  </div>
                  <p className="row-help">
                    {canAutofill ? autofill.hint : "Open the raw page or resume the paused step to finish this application manually."}
                  </p>
                </div>
              );
            })}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Ready to Open</p>
              <h2>Prepared packets</h2>
            </div>
          </div>
          <div className="stack-list">
            {readyApplications.length === 0 ? (
              <div className="stack-item">
                <p>No prepared applications yet</p>
                <span>Run the worker after onboarding and resume upload to prepare the next batch.</span>
              </div>
            ) : null}
            {readyApplications.map((application) => {
              const state = describeTrackerState(application);
              const targetUrl = application.applyUrl ?? application.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl,
              });
              return (
                <div key={application.id} className="stack-item">
                  <div className="stack-item-top">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.role}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View job
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open raw page
                      </a>
                    ) : null}
                  </div>
                  <div className="list-actions">
                    {canAutofill ? (
                      <form action={`/api/applications/${application.id}/autofill`} method="post">
                        <button type="submit" className="button button-primary">
                          {autofill.label}
                        </button>
                      </form>
                    ) : null}
                    <a href="/applications" className="button button-secondary">
                      See full packet
                    </a>
                  </div>
                  <p className="row-help">
                    {canAutofill ? autofill.hint : "Autofill is not supported for this ATS yet, so use the raw page and prepared answers manually."}
                  </p>
                </div>
              );
            })}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Submitted</p>
              <h2>Confirmed complete</h2>
            </div>
          </div>
          <div className="stack-list">
            {submittedApplications.length === 0 ? (
              <div className="stack-item">
                <p>No submitted applications yet</p>
                <span>Applications only appear here after a confirmed submit state or a manual confirmation.</span>
              </div>
            ) : null}
            {submittedApplications.map((application) => {
              const state = describeTrackerState(application);
              return (
                <div key={application.id} className="stack-item">
                  <div className="stack-item-top">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.role}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View job
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
              );
            })}
          </div>
        </article>
      </section>

      <section className="app-two-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Queued Next</p>
              <h2>Waiting for the next daily slot</h2>
            </div>
          </div>
          <div className="stack-list">
            {queuedApplications.length === 0 ? (
              <div className="stack-item">
                <p>No queued backlog</p>
                <span>Jobs that pass the fit rules but exceed the rolling 24-hour target appear here.</span>
              </div>
            ) : null}
            {queuedApplications.map((application) => {
              const state = describeTrackerState(application);
              return (
                <div key={application.id} className="stack-item">
                  <p>{application.company} - {application.role}</p>
                  <span>{state.detail}</span>
                  <div className="row-links">
                    <a href={application.jobUrl} className="inline-link" target="_blank" rel="noreferrer">
                      View job
                    </a>
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open raw page
                      </a>
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
              <p className="eyebrow">Notifications</p>
              <h2>Recent alerts</h2>
            </div>
          </div>
          <div className="stack-list">
            {notifications.length === 0 ? (
              <div className="stack-item">
                <p>No notifications</p>
                <span>The worker has not produced any alerts yet.</span>
              </div>
            ) : null}
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
