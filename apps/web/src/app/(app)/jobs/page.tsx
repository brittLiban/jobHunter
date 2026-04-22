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
  isGreaterSeattleArea,
  matchesLocation,
  matchesSearch,
  matchesSource,
  matchesStatus,
  readSearchParam,
} from "@/lib/list-filters";
import { loadJobsPageData } from "@/lib/page-data";

type JobsPageParams = {
  q?: string;
  status?: string;
  locationPreset?: string;
  locationText?: string;
  source?: string;
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<JobsPageParams>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const jobs = await loadJobsPageData(user.id);
  const q = readSearchParam(params.q);
  const statusFilter = readSearchParam(params.status) || "all";
  const locationPreset = readSearchParam(params.locationPreset) || "all";
  const locationText = readSearchParam(params.locationText);
  const sourceFilter = readSearchParam(params.source) || "all";

  const filteredJobs = jobs.filter((job) =>
    matchesSearch(
      [job.title, job.company, job.location, job.sourceName, job.description],
      q,
    )
    && matchesStatus(job.status, statusFilter)
    && matchesSource(job.sourceKind, sourceFilter)
    && matchesLocation({
      location: job.location,
      preset: locationPreset,
      customLocation: locationText,
    }),
  );

  const submittedCount = filteredJobs.filter((job) => job.status === "auto_submitted" || job.status === "submitted").length;
  const needsAttentionCount = filteredJobs.filter((job) => job.status === "needs_user_action").length;
  const preparedCount = filteredJobs.filter((job) => job.status === "prepared").length;
  const seattleAreaCount = filteredJobs.filter((job) => isGreaterSeattleArea(job.location)).length;
  const showingFiltered = Boolean(
    q
    || statusFilter !== "all"
    || locationPreset !== "all"
    || locationText
    || sourceFilter !== "all",
  );

  return (
    <AppShell
      title="Jobs"
      description="Search the full job feed by company, role, status, and location, then launch the right application action directly from the results."
      userName={user.fullName ?? user.email}
      currentPath="/jobs"
    >
      <section className="app-card app-toolbar">
        <div>
          <p className="eyebrow">Filters</p>
          <h2>Find the exact slice of jobs you want</h2>
          <p className="section-copy">
            Use the Greater Seattle preset for Seattle, Bellevue, Redmond, Kirkland, Renton, Tacoma, and nearby metro matches. Add a custom location term when you want something more specific.
          </p>
          <div className="quick-filters">
            <a
              href="/jobs"
              className={`filter-chip ${locationPreset === "all" && !locationText ? "filter-chip-active" : ""}`}
            >
              All jobs
            </a>
            <a
              href="/jobs?locationPreset=greater_seattle"
              className={`filter-chip ${locationPreset === "greater_seattle" ? "filter-chip-active" : ""}`}
            >
              Greater Seattle Area
            </a>
            <a
              href="/jobs?locationPreset=remote"
              className={`filter-chip ${locationPreset === "remote" ? "filter-chip-active" : ""}`}
            >
              Remote
            </a>
            <a
              href="/jobs?status=prepared"
              className={`filter-chip ${statusFilter === "prepared" ? "filter-chip-active" : ""}`}
            >
              Ready to run
            </a>
          </div>
        </div>
        <form action="/jobs" method="get" className="filter-bar">
          <label className="form-field form-field-inline">
            <span>Search</span>
            <input name="q" defaultValue={q} placeholder="Company or role" />
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
            <span>Source</span>
            <select name="source" defaultValue={sourceFilter}>
              <option value="all">All sources</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="mock">Mock</option>
              <option value="ashby">Ashby</option>
              <option value="lever">Lever</option>
              <option value="workable">Workable</option>
            </select>
          </label>
          <div className="filter-actions">
            <button type="submit" className="button button-primary">
              Apply filters
            </button>
            <a href="/jobs" className="button button-secondary">
              Reset
            </a>
          </div>
        </form>
      </section>

      <section className="app-grid app-metrics">
        <article className="app-card">
          <span>Results</span>
          <strong>{filteredJobs.length}</strong>
          <p className="metric-note">{showingFiltered ? `of ${jobs.length} tracked jobs` : "current full feed"}</p>
        </article>
        <article className="app-card">
          <span>Ready to run</span>
          <strong>{preparedCount}</strong>
        </article>
        <article className="app-card">
          <span>Needs attention</span>
          <strong>{needsAttentionCount}</strong>
        </article>
        <article className="app-card">
          <span>Submitted</span>
          <strong>{submittedCount}</strong>
        </article>
        <article className="app-card">
          <span>Seattle area in results</span>
          <strong>{seattleAreaCount}</strong>
        </article>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Results</p>
            <h2>{buildResultsHeading(filteredJobs.length, jobs.length, showingFiltered)}</h2>
          </div>
          <p className="section-copy">
            Location preset: {formatLocationPreset(locationPreset)}{locationText ? ` · Custom contains "${locationText}"` : ""}
          </p>
        </div>
        <div className="list-table">
          {filteredJobs.length === 0 ? (
            <div className="list-row list-row-rich">
              <div>
                <p>No jobs match the current filters</p>
                <span>Try clearing the location or status filters to widen the feed.</span>
              </div>
            </div>
          ) : null}
          {filteredJobs.map((job) => {
            const targetUrl = job.applyUrl ?? job.url;
            const canAutofill = Boolean(
              job.applicationId
              && ["prepared", "needs_user_action"].includes(job.status)
              && supportsAutofill(targetUrl),
            );
            const autofill = getAutofillActionSummary({
              status: job.status,
              targetUrl,
            });
            const state = describeTrackerState({
              status: job.status,
              blockingReason: job.blockingReason,
              preparedPayload: job.preparedPayload,
              submittedAt: job.submittedAt,
              needsUserActionAt: job.needsUserActionAt,
              updatedAt: job.applicationUpdatedAt ?? job.discoveredAt,
            });

            return (
              <div key={job.id} className="list-row list-row-rich job-row">
                <div>
                  <p>{job.title}</p>
                  <span>{job.company}</span>
                  <div className="meta-badges">
                    <span className="meta-badge">{job.location || "Location not listed"}</span>
                    <span className="meta-badge">{formatWorkMode(job.workMode)}</span>
                    <span className="meta-badge">{job.sourceName}</span>
                    {job.fitScore !== null ? <span className="meta-badge">Fit {job.fitScore}</span> : null}
                    <span className="meta-badge">{autofill.modeLabel}</span>
                  </div>
                  <div className="row-links">
                    <a href={job.url} className="inline-link" target="_blank" rel="noreferrer">
                      View posting
                    </a>
                    {job.applyUrl ? (
                      <a href={job.applyUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Open application only
                      </a>
                    ) : null}
                    {job.lastAutomationUrl ? (
                      <a href={job.lastAutomationUrl} className="inline-link" target="_blank" rel="noreferrer">
                        Resume paused step
                      </a>
                    ) : null}
                  </div>
                </div>
                <div>
                  <p>{state.label}</p>
                  <span>{state.detail}</span>
                  <p className="row-help">
                    {job.fitScore !== null
                      ? `Fit ${job.fitScore}/100 · Updated ${formatTimestamp(job.applicationUpdatedAt ?? job.discoveredAt)}`
                      : `Discovered ${formatTimestamp(job.discoveredAt)}`}
                  </p>
                </div>
                <div className="row-actions-column">
                  <StatusPill status={(job.status as Parameters<typeof StatusPill>[0]["status"]) ?? "discovered"} />
                  <div className="list-actions">
                    {canAutofill && job.applicationId ? (
                      <AutofillLaunchForm applicationId={job.applicationId} label={autofill.label} />
                    ) : null}
                    {job.applicationId ? (
                      <a href="/applications" className="button button-secondary">
                        Open queue
                      </a>
                    ) : null}
                  </div>
                  <p className="row-help">
                    {canAutofill ? autofill.hint : "Use the application link when you want the employer form without running automation."}
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

function buildResultsHeading(resultCount: number, totalCount: number, filtered: boolean) {
  if (!filtered) {
    return `All tracked jobs (${totalCount})`;
  }

  return `${resultCount} matching job${resultCount === 1 ? "" : "s"}`;
}

function formatWorkMode(workMode: string | null | undefined) {
  if (!workMode) {
    return "Work mode unknown";
  }

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
