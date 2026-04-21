import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { loadApplicationsPageData } from "@/lib/page-data";

const guardrails = [
  "Auto-submit only when the form flow is simple and predictable.",
  "Pause immediately on CAPTCHA, verification codes, upload failures, or unusual structure.",
  "Preserve prepared answers, selected fields, and resume context for quick manual completion.",
  "Never bypass security protections or guess unknown required answers.",
] as const;

const statusGuide = [
  "queued: job passed thresholding and is waiting for the next preparation or automation attempt",
  "prepared: tailored resume content and answers were saved and the application packet is ready",
  "needs_user_action: the system paused on friction and preserved state so you can finish quickly",
  "auto_submitted: automation reached a clear confirmation state and completed the submission",
  "submitted: the application is complete, whether manually or automatically",
] as const;

export default async function ApplicationsPage() {
  const user = await requireOnboardedUser();
  const applications = await loadApplicationsPageData(user.id);

  return (
    <AppShell
      title="Applications"
      description="Prepared packets, autonomous submissions, and manual checkpoints live in one queue with explicit status history."
      userName={user.fullName ?? user.email}
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
            {applications.length === 0 ? (
              <div className="list-row">
                <div>
                  <p>No applications yet</p>
                  <span>The worker has not prepared any job applications.</span>
                </div>
              </div>
            ) : null}
            {applications.map((application) => (
              <div key={application.id} className="list-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.title}</span>
                </div>
                <div>
                  <p>{application.generatedAnswers.length} answers</p>
                  <span>{application.fitScore !== null ? `${application.fitScore}/100 fit` : "Unscored"}</span>
                </div>
                <div className="row-status">
                  <StatusPill status={application.status as Parameters<typeof StatusPill>[0]["status"]} />
                </div>
                {application.status === "needs_user_action" ? (
                  <div className="list-actions">
                    {application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="button button-secondary">
                        Resume
                      </a>
                    ) : null}
                    <form action={`/api/applications/${application.id}/reopen`} method="post">
                      <button type="submit" className="button button-secondary">
                        Reopen
                      </button>
                    </form>
                  </div>
                ) : null}
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
                <p>{application.company} - {event.title}</p>
                <span>{event.detail ?? event.type}</span>
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
