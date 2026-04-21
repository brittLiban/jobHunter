import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { loadDashboardPageData } from "@/lib/page-data";

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const { overview, applications, notifications } = await loadDashboardPageData(user.id);

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
          <span>Auto Submitted</span>
          <strong>{overview.autoSubmitted}</strong>
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
          Trigger discovery, scoring, tailoring, and apply preparation for your current account.
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
              <p className="eyebrow">Latest Applications</p>
              <h2>Pipeline activity</h2>
            </div>
          </div>
          <div className="list-table">
            {applications.map((application) => (
              <div key={application.id} className="list-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.role}</span>
                </div>
                <div>
                  <p>{application.fitScore}/100</p>
                  <span>{application.source}</span>
                </div>
                <div className="row-status">
                  <StatusPill status={application.status} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Attention Queue</p>
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
        </article>
      </section>
    </AppShell>
  );
}
