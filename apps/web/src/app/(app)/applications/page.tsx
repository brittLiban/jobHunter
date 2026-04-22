import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import {
  describeTrackerState,
  formatTimestamp,
  getAutofillActionSummary,
  supportsAutofill,
} from "@/lib/application-presentation";
import { loadApplicationsPageData } from "@/lib/page-data";

const guardrails = [
  "Auto-submit only when the form flow is simple and predictable.",
  "Pause immediately on CAPTCHA, verification codes, upload failures, or unusual structure.",
  "Preserve prepared answers, selected fields, and resume context for quick manual completion.",
  "Never bypass security protections or guess unknown required answers.",
] as const;

type ApplicationsPageNotice = {
  tone: "success" | "info" | "warning";
  title: string;
  message: string;
};

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    autofill?: string;
    reason?: string;
    submitted?: string;
    reopened?: string;
  }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const notice = buildApplicationsNotice(params);
  const applications = await loadApplicationsPageData(user.id);
  const submittedApplications = applications.filter((application) =>
    application.status === "auto_submitted" || application.status === "submitted",
  );
  const attentionApplications = applications.filter((application) => application.status === "needs_user_action");
  const readyApplications = applications.filter((application) => application.status === "prepared");
  const queuedApplications = applications.filter((application) => application.status === "queued");

  return (
    <AppShell
      title="Applications"
      description="Everything is grouped by what you need to do next: finish, open, or leave queued."
      userName={user.fullName ?? user.email}
      currentPath="/applications"
    >
      {notice ? (
        <section className={`app-notice app-notice-${notice.tone}`}>
          <p className="notice-title">{notice.title}</p>
          <p className="notice-body">{notice.message}</p>
        </section>
      ) : null}

      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Actually Submitted</span>
          <strong>{submittedApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Needs You</span>
          <strong>{attentionApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Ready to Open</span>
          <strong>{readyApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Queued Next</span>
          <strong>{queuedApplications.length}</strong>
        </article>
      </section>

      <section className="app-card app-action-hero">
        <div className="card-heading">
          <div>
            <p className="eyebrow">How to use this queue</p>
            <h2>Use the right link on purpose</h2>
          </div>
        </div>
        <div className="action-guide-grid">
          <div className="stack-item">
            <p>Open and autofill</p>
            <span>Opens the application and starts the saved packet. On mock flows, you can watch it fill in-browser.</span>
          </div>
          <div className="stack-item">
            <p>Open raw page</p>
            <span>Just opens the employer form. It does not trigger autofill by itself.</span>
          </div>
          <div className="stack-item">
            <p>Resume paused step</p>
            <span>Takes you back to the exact page where automation stopped and saved the current state.</span>
          </div>
        </div>
      </section>

      <section className="app-three-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Needs You</p>
              <h2>Finish next</h2>
            </div>
          </div>
          <div className="stack-list">
            {attentionApplications.length === 0 ? (
              <div className="stack-item">
                <p>No application is waiting on you</p>
                <span>When a site pauses on real friction, it will show up here.</span>
              </div>
            ) : null}
            {attentionApplications.slice(0, 4).map((application) => {
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
                      <span>{application.title}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <span>{state.detail}</span>
                  <div className="list-actions">
                    {canAutofill ? (
                      <form action={`/api/applications/${application.id}/autofill`} method="post">
                        <button type="submit" className="button button-primary">
                          {autofill.label}
                        </button>
                      </form>
                    ) : null}
                    {application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                        Resume paused step
                      </a>
                    ) : null}
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
                <p>No prepared packets yet</p>
                <span>Run the worker or wait for queued jobs to move into the next available slot.</span>
              </div>
            ) : null}
            {readyApplications.slice(0, 4).map((application) => {
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
                      <span>{application.title}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <span>{describeTrackerState(application).detail}</span>
                  <div className="list-actions">
                    {canAutofill ? (
                      <form action={`/api/applications/${application.id}/autofill`} method="post">
                        <button type="submit" className="button button-primary">
                          {autofill.label}
                        </button>
                      </form>
                    ) : null}
                    {application.applyUrl ? (
                      <a href={application.applyUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                        Open raw page
                      </a>
                    ) : null}
                  </div>
                  <p className="row-help">
                    {canAutofill ? autofill.hint : "Autofill is not supported for this ATS yet, so use the raw page and saved packet manually."}
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
              <h2>Already complete</h2>
            </div>
          </div>
          <div className="stack-list">
            {submittedApplications.length === 0 ? (
              <div className="stack-item">
                <p>No confirmed submissions yet</p>
                <span>Applications move here only after a confirmed submit or a manual confirmation.</span>
              </div>
            ) : null}
            {submittedApplications.slice(0, 4).map((application) => (
              <div key={application.id} className="stack-item">
                <div className="stack-item-top">
                  <div>
                    <p>{application.company}</p>
                    <span>{application.title}</span>
                  </div>
                  <StatusPill status={application.status} />
                </div>
                <span>{describeTrackerState(application).detail}</span>
                <p className="row-help">
                  Submitted {formatTimestamp(application.submittedAt ?? application.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">All Applications</p>
            <h2>Full tracker</h2>
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
          {applications.map((application) => {
            const state = describeTrackerState(application);
            const targetUrl = application.applyUrl ?? application.jobUrl;
            const canMarkSubmitted = !["auto_submitted", "submitted", "skipped", "rejected", "offer"].includes(application.status);
            const canAutofill = ["prepared", "needs_user_action"].includes(application.status)
              && supportsAutofill(targetUrl);
            const autofill = getAutofillActionSummary({
              status: application.status,
              targetUrl,
            });

            return (
              <div key={application.id} className="list-row list-row-rich">
                <div>
                  <p>{application.company}</p>
                  <span>{application.title}</span>
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
                </div>
                <div>
                  <p>{state.label}</p>
                  <span>{state.detail}</span>
                </div>
                <div>
                  <p>{application.generatedAnswers.length} saved answer{application.generatedAnswers.length === 1 ? "" : "s"}</p>
                  <span>
                    {application.fitScore !== null
                      ? `Fit ${application.fitScore}/100 - ${formatTimestamp(application.updatedAt)}`
                      : `Updated ${formatTimestamp(application.updatedAt)}`}
                  </span>
                </div>
                <div className="row-status">
                  <StatusPill status={application.status} />
                </div>
                <div className="list-actions">
                  {canAutofill ? (
                    <form action={`/api/applications/${application.id}/autofill`} method="post">
                      <button type="submit" className="button button-primary">
                        {autofill.label}
                      </button>
                    </form>
                  ) : null}
                  {application.status === "needs_user_action" && application.lastAutomationUrl ? (
                    <a href={application.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                      Resume paused step
                    </a>
                  ) : null}
                  {canMarkSubmitted ? (
                    <form action={`/api/applications/${application.id}/mark-submitted`} method="post">
                      <button type="submit" className="button button-secondary">
                        Mark submitted
                      </button>
                    </form>
                  ) : null}
                  {application.status === "needs_user_action" ? (
                    <form action={`/api/applications/${application.id}/reopen`} method="post">
                      <button type="submit" className="button button-secondary">
                        Requeue
                      </button>
                    </form>
                  ) : null}
                </div>
                <p className="row-help row-help-wide">
                  {canAutofill ? autofill.hint : "Use the raw page when you want to review the employer form without triggering autofill."}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="app-two-column">
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

        <article className="app-card">
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
                  <span>{event.detail ?? event.type} - {formatTimestamp(event.createdAt)}</span>
                </div>
              )),
            )}
          </div>
        </article>
      </section>
    </AppShell>
  );
}

function buildApplicationsNotice(params: {
  autofill?: string;
  reason?: string;
  submitted?: string;
  reopened?: string;
}): ApplicationsPageNotice | null {
  if (params.submitted === "1") {
    return {
      tone: "success",
      title: "Application marked submitted",
      message: "The tracker now treats that application as complete.",
    };
  }

  if (params.reopened === "1") {
    return {
      tone: "info",
      title: "Application requeued",
      message: "The application moved back into the queue for another preparation or autofill pass.",
    };
  }

  if (params.autofill === "blocked") {
    return {
      tone: "warning",
      title: "Autofill could not start",
      message: params.reason ?? "The application flow could not be opened for autofill.",
    };
  }

  if (params.autofill === "auto_submitted") {
    return {
      tone: "success",
      title: "Application auto-submitted",
      message: "Autofill reached a confirmed submit state and the tracker marked the application complete.",
    };
  }

  if (params.autofill === "needs_user_action") {
    return {
      tone: "info",
      title: "Autofill paused for you",
      message: "The worker saved the current page and moved the application into Needs You.",
    };
  }

  if (params.autofill === "prepared") {
    return {
      tone: "info",
      title: "Autofill ran without a final confirmation",
      message: "The packet is still saved, but the worker did not detect a completed submission state.",
    };
  }

  return null;
}
