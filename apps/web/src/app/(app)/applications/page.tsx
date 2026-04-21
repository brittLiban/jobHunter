import { demoDashboardSnapshot } from "@jobhunter/core";

import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";

const guardrails = [
  "Auto-submit only when the form flow is simple and predictable.",
  "Pause immediately on CAPTCHA, verification codes, upload failures, or unusual structure.",
  "Preserve prepared answers, selected fields, and resume context for quick manual completion.",
  "Never bypass security protections or guess unknown required answers.",
] as const;

export default function ApplicationsPage() {
  return (
    <AppShell
      title="Applications"
      description="Prepared packets, autonomous submissions, and manual checkpoints live in one queue with explicit status history."
    >
      <section className="app-two-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Current applications</h2>
            </div>
          </div>
          <div className="list-table">
            {demoDashboardSnapshot.applications.map((application) => (
              <div key={application.id} className="list-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.role}</span>
                </div>
                <div>
                  <p>{application.generatedAnswersCount} answers</p>
                  <span>{application.fitScore}/100 fit</span>
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
    </AppShell>
  );
}
