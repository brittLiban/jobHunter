import { demoDashboardSnapshot } from "@jobhunter/core";

import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";

export default function DashboardPage() {
  const { overview, applications, notifications } = demoDashboardSnapshot;

  return (
    <AppShell
      title="Overview"
      description="Monitor queue health, submission outcomes, and the exact places where human input is still needed."
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
            {notifications.map((notification) => (
              <div key={notification.title} className="stack-item">
                <p>{notification.title}</p>
                <span>{notification.message}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AppShell>
  );
}
