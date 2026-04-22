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
import {
  formatLocationPreset,
  matchesLocation,
  matchesSearch,
  matchesStatus,
  readSearchParam,
} from "@/lib/list-filters";
import { loadApplicationsPageData } from "@/lib/page-data";

type ApplicationsPageNotice = {
  tone: "success" | "info" | "warning";
  title: string;
  message: string;
};

type ApplicationsPageParams = {
  autofill?: string;
  reason?: string;
  submitted?: string;
  reopened?: string;
  q?: string;
  status?: string;
  locationPreset?: string;
  locationText?: string;
};

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<ApplicationsPageParams>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const notice = buildApplicationsNotice(params);
  const q = readSearchParam(params.q);
  const statusFilter = readSearchParam(params.status) || "all";
  const locationPreset = readSearchParam(params.locationPreset) || "all";
  const locationText = readSearchParam(params.locationText);
  const applications = await loadApplicationsPageData(user.id);
  const filteredApplications = applications.filter((application) =>
    matchesSearch(
      [application.company, application.title, application.location, application.source],
      q,
    )
    && matchesStatus(application.status, statusFilter)
    && matchesLocation({
      location: application.location,
      preset: locationPreset,
      customLocation: locationText,
    }),
  );

  const submittedApplications = filteredApplications.filter((application) =>
    application.status === "auto_submitted" || application.status === "submitted",
  );
  const attentionApplications = filteredApplications.filter((application) => application.status === "needs_user_action");
  const readyApplications = filteredApplications.filter((application) => application.status === "prepared");
  const queuedApplications = filteredApplications.filter((application) => application.status === "queued");
  const recentEvents = filteredApplications
    .flatMap((application) =>
      application.events.slice(0, 1).map((event) => ({
        applicationId: application.id,
        company: application.company,
        title: application.title,
        event,
      })),
    )
    .slice(0, 6);

  return (
    <AppShell
      title="Applications"
      description="See what has already been submitted, what is ready for automation, and what still needs a human step."
      userName={user.fullName ?? user.email}
      currentPath="/applications"
    >
      {notice ? (
        <section className={`app-notice app-notice-${notice.tone}`}>
          <div>
            <p className="notice-title">{notice.title}</p>
            <p className="notice-body">{notice.message}</p>
          </div>
        </section>
      ) : null}

      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Results</span>
          <strong>{filteredApplications.length}</strong>
          <p className="metric-note">filtered application queue</p>
        </article>
        <article className="app-card">
          <span>Submitted</span>
          <strong>{submittedApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Needs attention</span>
          <strong>{attentionApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Ready to run</span>
          <strong>{readyApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Queued</span>
          <strong>{queuedApplications.length}</strong>
        </article>
      </section>

      <section className="app-card app-toolbar">
        <div>
          <p className="eyebrow">Queue Filters</p>
          <h2>Slice the application queue by status or place</h2>
          <p className="section-copy">
            Location preset: {formatLocationPreset(locationPreset)}{locationText ? ` · Custom contains "${locationText}"` : ""}.
          </p>
        </div>
        <form action="/applications" method="get" className="filter-bar">
          <label className="form-field form-field-inline">
            <span>Search</span>
            <input name="q" defaultValue={q} placeholder="Company or role" />
          </label>
          <label className="form-field form-field-inline">
            <span>Status</span>
            <select name="status" defaultValue={statusFilter}>
              <option value="all">All statuses</option>
              <option value="prepared">Ready to run</option>
              <option value="needs_user_action">Needs attention</option>
              <option value="auto_submitted">Auto-submitted</option>
              <option value="submitted">Submitted</option>
              <option value="queued">Queued</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
          <label className="form-field form-field-inline">
            <span>Location preset</span>
            <select name="locationPreset" defaultValue={locationPreset}>
              <option value="all">All locations</option>
              <option value="greater_seattle">Greater Seattle Area</option>
              <option value="seattle">Seattle only</option>
              <option value="remote">Remote</option>
            </select>
          </label>
          <label className="form-field form-field-inline">
            <span>Custom location</span>
            <input name="locationText" defaultValue={locationText} placeholder="Bellevue, San Francisco, etc." />
          </label>
          <div className="filter-actions">
            <button type="submit" className="button button-primary">
              Apply filters
            </button>
            <a href="/applications" className="button button-secondary">
              Reset
            </a>
          </div>
        </form>
      </section>

      <section className="panel-grid-two">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Needs Attention</p>
              <h2>Human steps only</h2>
            </div>
          </div>
          <div className="summary-list">
            {attentionApplications.length === 0 ? (
              <div className="summary-item">
                <p>No blocked applications right now</p>
                <span>Sites that pause on CAPTCHA, verification, or unknown required fields will show up here.</span>
              </div>
            ) : null}
            {attentionApplications.slice(0, 5).map((application) => {
              const targetUrl = application.applyUrl ?? application.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl,
              });
              return (
                <div key={application.id} className="summary-item">
                  <div className="summary-item-header">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.title}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <div className="meta-badges">
                    <span className="meta-badge">{application.location || "Location not listed"}</span>
                    <span className="meta-badge">{application.source}</span>
                    <span className="meta-badge">{autofill.modeLabel}</span>
                    {application.fitScore !== null ? <span className="meta-badge">Fit {application.fitScore}</span> : null}
                  </div>
                  <span>{describeTrackerState(application).detail}</span>
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
                    {application.status === "needs_user_action" && application.lastAutomationUrl ? (
                      <a href={application.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                        Resume paused step
                      </a>
                    ) : null}
                    <form action={`/api/applications/${application.id}/reopen`} method="post">
                      <button type="submit" className="button button-secondary">
                        Requeue
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
          </div>
          <div className="summary-list">
            {readyApplications.length === 0 ? (
              <div className="summary-item">
                <p>No prepared applications in this slice</p>
                <span>Run the worker or relax the filters to see more prepared packets.</span>
              </div>
            ) : null}
            {readyApplications.slice(0, 5).map((application) => {
              const targetUrl = application.applyUrl ?? application.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({
                status: application.status,
                targetUrl,
              });
              return (
                <div key={application.id} className="summary-item">
                  <div className="summary-item-header">
                    <div>
                      <p>{application.company}</p>
                      <span>{application.title}</span>
                    </div>
                    <StatusPill status={application.status} />
                  </div>
                  <div className="meta-badges">
                    <span className="meta-badge">{application.location || "Location not listed"}</span>
                    <span className="meta-badge">{application.source}</span>
                    <span className="meta-badge">{autofill.modeLabel}</span>
                    {application.fitScore !== null ? <span className="meta-badge">Fit {application.fitScore}</span> : null}
                  </div>
                  <span>{describeTrackerState(application).detail}</span>
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
      </section>

      <section className="panel-grid-two">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Submitted</p>
              <h2>Confirmed finishes</h2>
            </div>
          </div>
          <div className="summary-list">
            {submittedApplications.length === 0 ? (
              <div className="summary-item">
                <p>No confirmed submissions in this slice</p>
                <span>Submitted applications only land here after a detected confirmation or manual confirmation.</span>
              </div>
            ) : null}
            {submittedApplications.slice(0, 5).map((application) => (
              <div key={application.id} className="summary-item">
                <div className="summary-item-header">
                  <div>
                    <p>{application.company}</p>
                    <span>{application.title}</span>
                  </div>
                  <StatusPill status={application.status} />
                </div>
                <div className="meta-badges">
                  <span className="meta-badge">{application.location || "Location not listed"}</span>
                  <span className="meta-badge">{application.source}</span>
                  {application.fitScore !== null ? <span className="meta-badge">Fit {application.fitScore}</span> : null}
                </div>
                <span>{describeTrackerState(application).detail}</span>
                <p className="row-help">Submitted {formatTimestamp(application.submittedAt ?? application.updatedAt)}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Latest Activity</p>
              <h2>Recent lifecycle events</h2>
            </div>
          </div>
          <div className="summary-list">
            {recentEvents.length === 0 ? (
              <div className="summary-item">
                <p>No recent events</p>
                <span>Activity will appear here after the worker prepares or updates applications.</span>
              </div>
            ) : null}
            {recentEvents.map((item) => (
              <div key={item.event.id} className="summary-item">
                <p>{item.company} · {item.event.title}</p>
                <span>{item.title}</span>
                <p className="row-help">
                  {item.event.detail ?? item.event.type} · {formatTimestamp(item.event.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Full Tracker</p>
            <h2>All matching applications</h2>
          </div>
        </div>
        <div className="list-table">
          {filteredApplications.length === 0 ? (
            <div className="list-row list-row-rich">
              <div>
                <p>No applications match the current filters</p>
                <span>Clear the status or location filters to widen the queue.</span>
              </div>
            </div>
          ) : null}
          {filteredApplications.map((application) => {
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
              <div key={application.id} className="list-row list-row-rich job-row">
                <div>
                  <p>{application.company}</p>
                  <span>{application.title}</span>
                  <div className="meta-badges">
                    <span className="meta-badge">{application.location || "Location not listed"}</span>
                    <span className="meta-badge">{application.source}</span>
                    <span className="meta-badge">{autofill.modeLabel}</span>
                    {application.workMode ? <span className="meta-badge">{formatWorkMode(application.workMode)}</span> : null}
                    {application.fitScore !== null ? <span className="meta-badge">Fit {application.fitScore}</span> : null}
                  </div>
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
                </div>
                <div>
                  <p>{state.label}</p>
                  <span>{state.detail}</span>
                  <p className="row-help">
                    {application.generatedAnswers.length} saved answer{application.generatedAnswers.length === 1 ? "" : "s"} · Updated {formatTimestamp(application.updatedAt)}
                  </p>
                </div>
                <div className="row-actions-column">
                  <StatusPill status={application.status} />
                  <div className="list-actions">
                    {canAutofill ? (
                      <AutofillLaunchForm applicationId={application.id} label={autofill.label} />
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
                  <p className="row-help">
                    {canAutofill ? autofill.hint : "Open the employer page directly when you want to inspect the form without running automation."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}

function buildApplicationsNotice(params: ApplicationsPageParams): ApplicationsPageNotice | null {
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
      message: "The worker saved the current page and moved the application into Needs Attention.",
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

function formatWorkMode(workMode: string) {
  switch (workMode) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "on_site":
      return "On-site";
    default:
      return "Flexible";
  }
}
