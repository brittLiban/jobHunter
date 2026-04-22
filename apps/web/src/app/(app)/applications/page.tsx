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
  override?: string;
  reason?: string;
  submitted?: string;
  reopened?: string;
  q?: string;
  status?: string;
  locationPreset?: string;
  locationText?: string;
  focus?: string;
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
  const statusFilter = readSearchParam(params.status) || "actionable";
  const locationPreset = readSearchParam(params.locationPreset) || "all";
  const locationText = readSearchParam(params.locationText);
  const focusId = readSearchParam(params.focus);
  const applications = await loadApplicationsPageData(user.id);

  const filteredApplications = applications.filter((application) =>
    matchesSearch(
      [application.company, application.title, application.location, application.source],
      q,
    )
    && matchesApplicationStatus(application.status, statusFilter)
    && matchesLocation({
      location: application.location,
      preset: locationPreset,
      customLocation: locationText,
    }),
  );

  const reviewableApplications = filteredApplications.filter((application) =>
    ["prepared", "needs_user_action", "queued"].includes(application.status),
  );
  const focusPool =
    statusFilter === "actionable"
      ? (reviewableApplications.length > 0 ? reviewableApplications : filteredApplications)
      : filteredApplications;
  const focusedApplication = focusPool.find((application) => application.id === focusId) ?? focusPool[0] ?? null;
  const focusedTrackerSummary = focusedApplication ? describeTrackerState(focusedApplication) : null;
  const focusedIndex = focusedApplication ? focusPool.findIndex((application) => application.id === focusedApplication.id) : -1;
  const previousApplication = focusedIndex > 0 ? focusPool[focusedIndex - 1] : null;
  const nextApplication = focusedIndex >= 0 && focusedIndex < focusPool.length - 1 ? focusPool[focusedIndex + 1] : null;

  const readyCount = filteredApplications.filter((application) => application.status === "prepared").length;
  const needsAttentionCount = filteredApplications.filter((application) => application.status === "needs_user_action").length;
  const submittedCount = filteredApplications.filter((application) => ["auto_submitted", "submitted"].includes(application.status)).length;

  return (
    <AppShell
      title="Review Queue"
      description="Rotate through the jobs you actually want, inspect the fit summary, and launch autofill from the selected application."
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
          <span>In view</span>
          <strong>{filteredApplications.length}</strong>
        </article>
        <article className="app-card">
          <span>Ready to run</span>
          <strong>{readyCount}</strong>
        </article>
        <article className="app-card">
          <span>Needs attention</span>
          <strong>{needsAttentionCount}</strong>
        </article>
        <article className="app-card">
          <span>Submitted</span>
          <strong>{submittedCount}</strong>
        </article>
      </section>

      <section className="app-card app-toolbar">
        <div>
          <p className="eyebrow">Queue Filters</p>
          <h2>Control what you review</h2>
          <p className="section-copy">
            Default mode shows actionable items only. Use location and search filters to narrow the queue, including Greater Seattle.
          </p>
        </div>
        <form action="/applications" method="get" className="filter-bar review-filter-bar">
          <label className="form-field form-field-inline">
            <span>Search</span>
            <input name="q" defaultValue={q} placeholder="Company or role" />
          </label>
          <label className="form-field form-field-inline">
            <span>Status</span>
            <select name="status" defaultValue={statusFilter}>
              <option value="actionable">Actionable only</option>
              <option value="prepared">Ready to run</option>
              <option value="needs_user_action">Needs attention</option>
              <option value="queued">Queued</option>
              <option value="submitted">Submitted</option>
              <option value="all">All statuses</option>
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
            <input name="locationText" defaultValue={locationText} placeholder="Bellevue, Seattle, remote" />
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

      <section className="review-layout">
        <aside className="app-card review-rail">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>{reviewableApplications.length > 0 ? "Rotate the shortlist" : "Filtered results"}</h2>
            </div>
            <p className="section-copy">{formatLocationPreset(locationPreset)}</p>
          </div>
          <div className="review-rail-list">
            {focusPool.length === 0 ? (
              <div className="review-rail-item review-rail-item-empty">
                <p>No applications match the current filters</p>
                <span>Broaden the status or location filters to pull more jobs into view.</span>
              </div>
            ) : null}
            {focusPool.map((application) => (
              <a
                key={application.id}
                href={buildFocusHref({
                  ...params,
                  q,
                  status: statusFilter,
                  locationPreset,
                  locationText,
                }, application.id)}
                className={`review-rail-item ${focusedApplication?.id === application.id ? "review-rail-item-active" : ""}`}
              >
                <div className="review-rail-top">
                  <div>
                    <p>{application.company}</p>
                    <span>{application.title}</span>
                  </div>
                  <StatusPill status={application.status} />
                </div>
                <span>{application.location || "Location not listed"}</span>
                <p className="row-help">
                  {application.fitScore !== null ? `Fit ${application.fitScore}` : "No fit score"} · {application.seniority ?? "seniority pending"}
                </p>
              </a>
            ))}
          </div>
        </aside>

        <article className="app-card review-detail">
          {!focusedApplication ? (
            <div className="review-empty-state">
              <p className="eyebrow">No focused application</p>
              <h2>Pick a job from the queue</h2>
              <p className="section-copy">When a job is selected, its fit summary and autofill actions will show here.</p>
            </div>
          ) : (
            <>
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Selected Application</p>
                  <h2>{focusedApplication.company} · {focusedApplication.title}</h2>
                </div>
                <StatusPill status={focusedApplication.status} />
              </div>

              <div className="review-detail-meta">
                <span>{focusedApplication.location || "Location not listed"}</span>
                <span>{focusedApplication.source}</span>
                <span>{focusedApplication.seniority ? `${capitalize(focusedApplication.seniority)} level` : "Seniority pending"}</span>
                <span>{focusedApplication.fitScore !== null ? `Fit ${focusedApplication.fitScore}` : "No fit score"}</span>
              </div>

              {focusedTrackerSummary ? (
                <p className="eyebrow">{focusedTrackerSummary.label}</p>
              ) : null}
              <p className="review-detail-copy">{focusedTrackerSummary?.detail}</p>

              <div className="review-action-row">
                {renderAutofillAction(focusedApplication)}
                {focusedApplication.applyUrl ? (
                  <a href={focusedApplication.applyUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                    Open application only
                  </a>
                ) : null}
                <a href={focusedApplication.jobUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                  View posting
                </a>
                {focusedApplication.lastAutomationUrl ? (
                  <a href={focusedApplication.lastAutomationUrl} className="button button-secondary" target="_blank" rel="noreferrer">
                    Open paused page
                  </a>
                ) : null}
              </div>

              <div className="review-nav-row">
                {previousApplication ? (
                  <a
                    href={buildFocusHref({
                      ...params,
                      q,
                      status: statusFilter,
                      locationPreset,
                      locationText,
                    }, previousApplication.id)}
                    className="button button-secondary"
                  >
                    Previous
                  </a>
                ) : <span />}
                <p className="row-help">
                  {focusedIndex + 1} of {focusPool.length} in this queue
                </p>
                {nextApplication ? (
                  <a
                    href={buildFocusHref({
                      ...params,
                      q,
                      status: statusFilter,
                      locationPreset,
                      locationText,
                    }, nextApplication.id)}
                    className="button button-secondary"
                  >
                    Next
                  </a>
                ) : <span />}
              </div>

              <div className="review-detail-grid">
                <div className="review-detail-panel">
                  <p className="eyebrow">Top Matches</p>
                  {focusedApplication.topMatches.length === 0 ? (
                    <p className="section-copy">No stored fit explanation yet.</p>
                  ) : (
                    <ul className="flat-list">
                      {focusedApplication.topMatches.map((item: string) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="review-detail-panel">
                  <p className="eyebrow">Major Gaps</p>
                  {focusedApplication.majorGaps.length === 0 ? (
                    <p className="section-copy">No major gap callouts were saved for this application.</p>
                  ) : (
                    <ul className="flat-list">
                      {focusedApplication.majorGaps.map((item: string) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="review-detail-grid">
                <div className="review-detail-panel">
                  <p className="eyebrow">Prepared Materials</p>
                  <p className="section-copy">
                    {focusedApplication.generatedAnswers.length} short answer{focusedApplication.generatedAnswers.length === 1 ? "" : "s"} saved
                  </p>
                  <p className="row-help">
                    Updated {formatTimestamp(focusedApplication.updatedAt)}
                    {focusedApplication.scoreConfidence !== null ? ` · Score confidence ${Math.round(focusedApplication.scoreConfidence * 100)}%` : ""}
                  </p>
                </div>
                <div className="review-detail-panel">
                  <p className="eyebrow">Latest Event</p>
                  {focusedApplication.events[0] ? (
                    <>
                      <p>{focusedApplication.events[0].title}</p>
                      <p className="row-help">
                        {focusedApplication.events[0].detail ?? focusedApplication.events[0].type} · {formatTimestamp(focusedApplication.events[0].createdAt)}
                      </p>
                    </>
                  ) : (
                    <p className="section-copy">No lifecycle event has been stored yet.</p>
                  )}
                </div>
              </div>

              {focusedApplication.automationSummary
                && (
                  focusedApplication.automationSummary.filledFieldCount > 0
                  || focusedApplication.automationSummary.unknownRequiredFields.length > 0
                  || focusedApplication.automationSummary.missingProfileFields.length > 0
                ) ? (
                  <div className="review-detail-grid">
                    <div className="review-detail-panel">
                      <p className="eyebrow">Autofill Progress</p>
                      <p className="section-copy">
                        Last live run autofilled {focusedApplication.automationSummary.filledFieldCount} field{focusedApplication.automationSummary.filledFieldCount === 1 ? "" : "s"} before pausing.
                      </p>
                      {focusedApplication.automationSummary.unknownRequiredFields.length > 0 ? (
                        <div className="stack-list">
                          {focusedApplication.automationSummary.unknownRequiredFields.map((item: string) => (
                            <form
                              key={item}
                              action={`/api/applications/${focusedApplication.id}/field-overrides`}
                              method="post"
                              className="stack-item"
                            >
                              <input type="hidden" name="label" value={item} />
                              <label className="form-field">
                                <span>Needs your answer: {item}</span>
                                <input
                                  name="value"
                                  placeholder="Type the answer to reuse on retry"
                                  defaultValue={getSavedFieldOverride(focusedApplication.preparedPayload, item)}
                                />
                              </label>
                              <button type="submit" className="button button-secondary">Save answer</button>
                            </form>
                          ))}
                        </div>
                      ) : (
                        <p className="row-help">No unresolved required field mappings were left behind.</p>
                      )}
                    </div>
                    <div className="review-detail-panel">
                      <p className="eyebrow">Resume Guidance</p>
                      {focusedApplication.automationSummary.missingProfileFields.length > 0 ? (
                        <ul className="flat-list">
                          {focusedApplication.automationSummary.missingProfileFields.map((item: string) => (
                            <li key={item}>Missing profile field: {item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="section-copy">
                          Open paused page to finish the employer form, or retry live autofill after updating your profile or resume packet.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

              <div className="review-secondary-actions">
                {focusedApplication.status === "needs_user_action" ? (
                  <form action={`/api/applications/${focusedApplication.id}/reopen`} method="post">
                    <button type="submit" className="button button-secondary">
                      Requeue
                    </button>
                  </form>
                ) : null}
                {!["auto_submitted", "submitted", "skipped", "rejected", "offer"].includes(focusedApplication.status) ? (
                  <form action={`/api/applications/${focusedApplication.id}/mark-submitted`} method="post">
                    <button type="submit" className="button button-secondary">
                      Mark submitted
                    </button>
                  </form>
                ) : null}
              </div>
            </>
          )}
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Compact List</p>
            <h2>All filtered applications</h2>
          </div>
        </div>
        <div className="list-table">
          {filteredApplications.map((application) => (
            <div key={application.id} className="list-row review-table-row">
              <div>
                <p>{application.company}</p>
                <span>{application.title}</span>
              </div>
              <div>
                <p>{application.location || "Location not listed"}</p>
                <span>{application.seniority ? `${capitalize(application.seniority)} level` : "Seniority pending"}</span>
              </div>
              <div>
                <p>{application.fitScore !== null ? `Fit ${application.fitScore}` : "No fit score"}</p>
                <span>{application.source}</span>
              </div>
              <div className="list-actions">
                <a
                  href={buildFocusHref({
                    ...params,
                    q,
                    status: statusFilter,
                    locationPreset,
                    locationText,
                  }, application.id)}
                  className="button button-secondary"
                >
                  Review
                </a>
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

function renderAutofillAction(application: {
  id: string;
  status: string;
  applyUrl?: string | null;
  jobUrl: string;
}) {
  const targetUrl = application.applyUrl ?? application.jobUrl;
  const canAutofill = ["prepared", "needs_user_action"].includes(application.status) && supportsAutofill(targetUrl);
  if (!canAutofill) {
    return null;
  }

  const autofill = getAutofillActionSummary({
    status: application.status,
    targetUrl,
  });

  return <AutofillLaunchForm applicationId={application.id} label={autofill.label} />;
}

function matchesApplicationStatus(status: string, filter: string) {
  if (!filter || filter === "actionable") {
    return ["prepared", "needs_user_action", "queued"].includes(status);
  }

  if (filter === "submitted") {
    return ["submitted", "auto_submitted"].includes(status);
  }

  if (filter === "all") {
    return true;
  }

  return status === filter;
}

function buildFocusHref(params: ApplicationsPageParams, focus: string) {
  const next = new URLSearchParams();
  if (params.q) {
    next.set("q", params.q);
  }
  if (params.status) {
    next.set("status", params.status);
  }
  if (params.locationPreset) {
    next.set("locationPreset", params.locationPreset);
  }
  if (params.locationText) {
    next.set("locationText", params.locationText);
  }
  next.set("focus", focus);
  return `/applications?${next.toString()}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildApplicationsNotice(params: ApplicationsPageParams): ApplicationsPageNotice | null {
  if (params.override === "1") {
    return {
      tone: "success",
      title: "Saved for next autofill run",
      message: "Your answer was saved to this application packet and will be reused when you retry live autofill.",
    };
  }

  if (params.override === "blocked") {
    return {
      tone: "warning",
      title: "Could not save answer",
      message: "The question label was missing. Reopen the application and try again.",
    };
  }

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

function getSavedFieldOverride(payload: unknown, label: string) {
  if (!isRecord(payload) || !isRecord(payload.fieldOverrides)) {
    return "";
  }

  const key = normalizeFieldOverrideKey(label);
  const value = payload.fieldOverrides[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFieldOverrideKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
