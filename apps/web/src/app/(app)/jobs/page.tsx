import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { formatTimestamp } from "@/lib/application-presentation";
import {
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
  seniority?: string;
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<JobsPageParams>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const jobs = await loadJobsPageData(user.id);

  const q               = readSearchParam(params.q);
  const statusFilter    = readSearchParam(params.status) || "all";
  const locationPreset  = readSearchParam(params.locationPreset) || "all";
  const locationText    = readSearchParam(params.locationText);
  const sourceFilter    = readSearchParam(params.source) || "all";
  const seniorityFilter = readSearchParam(params.seniority) || "all";

  const filtered = jobs.filter((job) =>
    matchesSearch([job.title, job.company, job.location, job.sourceName, job.description], q)
    && matchesStatus(job.status, statusFilter)
    && matchesSource(job.sourceKind, sourceFilter)
    && (seniorityFilter === "all" || (job.seniority ?? "unknown") === seniorityFilter)
    && matchesLocation({ location: job.location, preset: locationPreset, customLocation: locationText }),
  );

  const preparedCount  = filtered.filter((j) => j.status === "prepared").length;
  const attentionCount = filtered.filter((j) => j.status === "needs_user_action").length;
  const submittedCount = filtered.filter((j) => ["auto_submitted", "submitted"].includes(j.status)).length;
  const seattleCount   = filtered.filter((j) => isGreaterSeattleArea(j.location)).length;

  const isFiltered = Boolean(q || statusFilter !== "all" || locationPreset !== "all" || locationText || sourceFilter !== "all" || seniorityFilter !== "all");

  return (
    <AppShell
      title="Discovery"
      description="Jobs found by your scraper that match your preferences."
      userName={user.fullName ?? user.email}
      currentPath="/jobs"
    >
      {/* Stats */}
      <div className="metrics-strip">
        <div className="metric-card">
          <div className="metric-label">Showing</div>
          <div className="metric-value">{filtered.length}</div>
          <div className="metric-sub">{isFiltered ? `of ${jobs.length} total` : "all jobs"}</div>
        </div>
        <div className="metric-card accent">
          <div className="metric-label">Ready</div>
          <div className="metric-value">{preparedCount}</div>
          <div className="metric-sub">prepared</div>
        </div>
        <div className={`metric-card${attentionCount > 0 ? " yellow" : ""}`}>
          <div className="metric-label">Attention</div>
          <div className="metric-value">{attentionCount}</div>
          <div className="metric-sub">blocked</div>
        </div>
        <div className="metric-card green">
          <div className="metric-label">Submitted</div>
          <div className="metric-value">{submittedCount}</div>
          <div className="metric-sub">confirmed</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Seattle Area</div>
          <div className="metric-value">{seattleCount}</div>
          <div className="metric-sub">in location</div>
        </div>
      </div>

      <div className="card">
        {/* Filter bar */}
        <form action="/jobs" method="get" className="filter-bar">
          <div className="form-field" style={{ flex: 2, minWidth: 160 }}>
            <label className="form-label">Search</label>
            <input className="form-input" name="q" defaultValue={q} placeholder="Company, role, or keyword…" />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label className="form-label">Status</label>
            <select className="form-select" name="status" defaultValue={statusFilter}>
              <option value="all">All statuses</option>
              <option value="prepared">Ready to run</option>
              <option value="needs_user_action">Needs attention</option>
              <option value="auto_submitted">Auto-submitted</option>
              <option value="submitted">Submitted</option>
              <option value="queued">Queued</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label className="form-label">Location</label>
            <select className="form-select" name="locationPreset" defaultValue={locationPreset}>
              <option value="all">All</option>
              <option value="greater_seattle">Greater Seattle</option>
              <option value="seattle">Seattle only</option>
              <option value="remote">Remote</option>
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 110 }}>
            <label className="form-label">Source</label>
            <select className="form-select" name="source" defaultValue={sourceFilter}>
              <option value="all">All sources</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="ashby">Ashby</option>
              <option value="lever">Lever</option>
              <option value="workable">Workable</option>
              <option value="mock">Mock</option>
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 110 }}>
            <label className="form-label">Seniority</label>
            <select className="form-select" name="seniority" defaultValue={seniorityFilter}>
              <option value="all">All levels</option>
              <option value="entry">Entry</option>
              <option value="mid">Mid</option>
              <option value="senior">Senior</option>
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <button type="submit" className="btn btn-primary btn-sm">Filter</button>
            <a href="/jobs" className="btn btn-secondary btn-sm">Reset</a>
          </div>
        </form>

        {/* Quick filter chips */}
        <div className="filter-chips">
          <a href="/jobs" className={`filter-chip${!isFiltered ? " active" : ""}`}>All</a>
          <a href="/jobs?locationPreset=greater_seattle" className={`filter-chip${locationPreset === "greater_seattle" ? " active" : ""}`}>Seattle Area</a>
          <a href="/jobs?status=prepared" className={`filter-chip${statusFilter === "prepared" ? " active" : ""}`}>Ready to run</a>
          <a href="/jobs?status=needs_user_action" className={`filter-chip${statusFilter === "needs_user_action" ? " active" : ""}`}>Needs attention</a>
          <a href="/jobs?locationPreset=remote" className={`filter-chip${locationPreset === "remote" ? " active" : ""}`}>Remote only</a>
        </div>

        {/* Table header */}
        <div className="jobs-table-header">
          <span>Job</span>
          <span>Location / Source</span>
          <span>Seniority</span>
          <span>Fit</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {/* Table rows */}
        <div className="divide-y">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="6.5" cy="6.5" r="4" />
                <path strokeLinecap="round" d="M10 10L14 14" />
              </svg>
              <p className="empty-state-title">No jobs match these filters</p>
              <p className="empty-state-body">Try broadening the filters or run the scraper to discover more jobs.</p>
            </div>
          ) : null}
          {filtered.map((job) => {
            const score = job.fitScore;
            const tier = score === null ? null : score >= 80 ? "high" : score >= 60 ? "medium" : "low";
            return (
              <div key={job.id} className="jobs-table-row">
                {/* Title + company */}
                <div>
                  <div className="job-title-primary">{job.title}</div>
                  <div className="job-company-name">{job.company}</div>
                  {job.salaryMin ? (
                    <div className="job-salary">
                      ${(job.salaryMin / 1000).toFixed(0)}k{job.salaryMax ? `–$${(job.salaryMax / 1000).toFixed(0)}k` : "+"}
                    </div>
                  ) : null}
                </div>

                {/* Location + source */}
                <div>
                  <div className="job-location-text">{job.location || "Not listed"}</div>
                  <div className="job-source-name">{job.sourceName}</div>
                  {job.workMode ? <div className="job-salary">{formatWorkMode(job.workMode)}</div> : null}
                </div>

                {/* Seniority */}
                <div>
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {job.seniority ? capitalize(job.seniority) : "–"}
                  </span>
                  {job.seniorityConfidence ? (
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {Math.round((job.seniorityConfidence ?? 0) * 100)}% conf
                    </div>
                  ) : null}
                </div>

                {/* Fit score */}
                <div>
                  {score !== null && tier ? (
                    <div className="fit-bar-wrap" style={{ alignItems: "flex-start" }}>
                      <div className={`fit-score ${tier}`}>{score}</div>
                      <div className="fit-bar-track" style={{ width: 56 }}>
                        <div className={`fit-bar-fill ${tier}`} style={{ width: `${score}%` }} />
                      </div>
                    </div>
                  ) : <span style={{ color: "var(--text-3)", fontSize: 12 }}>–</span>}
                </div>

                {/* Status + time */}
                <div>
                  <StatusPill status={(job.status as Parameters<typeof StatusPill>[0]["status"]) ?? "discovered"} />
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                    {formatTimestamp(job.applicationUpdatedAt ?? job.discoveredAt)}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                  <a href={job.url} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Post</a>
                  {job.applyUrl ? (
                    <a href={buildExtensionUrl(job.applyUrl, job.applicationId)} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">Apply</a>
                  ) : null}
                  {job.applicationId ? (
                    <a href={`/applications?focus=${job.applicationId}`} className="btn btn-ghost btn-sm">Queue</a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function buildExtensionUrl(url: string, applicationId: string | null | undefined) {
  if (!applicationId) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("jhApplicationId", applicationId);
    parsed.searchParams.set("jhRefresh", "1");
    return parsed.toString();
  } catch { return url; }
}

function formatWorkMode(mode: string) {
  const map: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", on_site: "On-site" };
  return map[mode] ?? "Flexible";
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
