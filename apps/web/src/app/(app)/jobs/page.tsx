import { demoDashboardSnapshot } from "@jobhunter/core";

import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";

export default function JobsPage() {
  return (
    <AppShell
      title="Jobs Found"
      description="Review discovered roles, fit scores, source coverage, and which jobs have moved into the application queue."
    >
      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Source Coverage</p>
            <h2>Jobs above threshold</h2>
          </div>
        </div>
        <div className="list-table">
          {demoDashboardSnapshot.applications.map((application) => (
            <div key={application.id} className="list-row">
              <div>
                <p>{application.role}</p>
                <span>{application.company}</span>
              </div>
              <div>
                <p>{application.source}</p>
                <span>Fit {application.fitScore}/100</span>
              </div>
              <div className="row-status">
                <StatusPill status={application.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
