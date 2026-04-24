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
import { loadDashboardPageData } from "@/lib/page-data";
import { getWorkerStatus } from "@/lib/worker-state";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ worker?: string; notification?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const { overview, applications, notifications } = await loadDashboardPageData(user.id);
  const workerStatus = getWorkerStatus();

  const attentionApps  = applications.filter((a) => a.status === "needs_user_action").slice(0, 6);
  const readyApps      = applications.filter((a) => a.status === "prepared").slice(0, 6);
  const submittedApps  = applications.filter((a) => ["auto_submitted", "submitted"].includes(a.status)).slice(0, 6);
  const queuedCount    = applications.filter((a) => a.status === "queued").length;

  const successNotice = params.worker === "ran"
    ? "Worker cycle complete — discovery, scoring, tailoring, and preparation ran for your account."
    : null;

  return (
    <AppShell
      title="Overview"
      description="Your live application pipeline."
      userName={user.fullName ?? user.email}
      currentPath="/dashboard"
      scraperRunning={workerStatus.running}
      attentionCount={attentionApps.length}
    >
      {/* Notice */}
      {successNotice ? (
        <div className="notice notice-success">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" />
          </svg>
          <div>
            <p className="notice-title">Worker finished</p>
            <p className="notice-body">{successNotice}</p>
          </div>
        </div>
      ) : null}

      {/* ── Metrics strip ─────────────────────────────── */}
      <div className="metrics-strip">
        <div className="metric-card">
          <div className="metric-label">Total Jobs</div>
          <div className="metric-value">{overview.jobsFound}</div>
          <div className="metric-sub">discovered</div>
        </div>
        <div className="metric-card accent">
          <div className="metric-label">Above Threshold</div>
          <div className="metric-value">{overview.aboveThreshold}</div>
          <div className="metric-sub">scored ≥ {Math.round((overview.aboveThreshold / Math.max(overview.jobsFound, 1)) * 100)}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Ready to Run</div>
          <div className="metric-value">{overview.prepared}</div>
          <div className="metric-sub">prepared packets</div>
        </div>
        {overview.needsUserAction > 0 ? (
          <div className="metric-card yellow">
            <div className="metric-label">Needs Attention</div>
            <div className="metric-value">{overview.needsUserAction}</div>
            <div className="metric-sub">blocked apps</div>
          </div>
        ) : (
          <div className="metric-card">
            <div className="metric-label">Needs Attention</div>
            <div className="metric-value">0</div>
            <div className="metric-sub">queue clear</div>
          </div>
        )}
        <div className="metric-card green">
          <div className="metric-label">Submitted</div>
          <div className="metric-value">{overview.submittedTotal}</div>
          <div className="metric-sub">confirmed</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Daily Cap</div>
          <div className="metric-value">{overview.preparedInLast24Hours}<span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-2)" }}>/{overview.dailyTargetVolume}</span></div>
          <div className="metric-sub">{overview.remainingDailyCapacity} remaining today</div>
        </div>
      </div>

      {/* ── Scraper Control Panel ─────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Scraper Control</div>
            <div className="card-subtitle">
              {workerStatus.running ? (
                <span style={{ color: "var(--yellow)" }}>● Running now…</span>
              ) : workerStatus.lastRanAt ? (
                `Last ran ${formatTimestamp(workerStatus.lastRanAt)}`
              ) : (
                "Not yet run this session"
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/profile#boards" className="btn btn-secondary btn-sm">Configure boards</a>
            <form action="/api/worker/run" method="post">
              <button type="submit" className="btn btn-primary btn-sm">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l9 5-9 5V3z" />
                </svg>
                Run all sources
              </button>
            </form>
          </div>
        </div>
        <div className="card-body-sm">
          <ScraperBoardGrid lastResult={workerStatus.lastResult} />
        </div>
        {workerStatus.lastResult ? (
          <div className="card-footer" style={{ fontSize: 12, color: "var(--text-2)", gap: 16 }}>
            <span>Last run: <strong style={{ color: "var(--text)" }}>{workerStatus.lastResult.discoveredJobs} jobs discovered</strong></span>
            <span>{workerStatus.lastResult.scoredApplications} scored</span>
            <span>{workerStatus.lastResult.preparedApplications} prepared</span>
            {workerStatus.lastResult.autoSubmittedApplications > 0 ? (
              <span style={{ color: "var(--green)", fontWeight: 600 }}>{workerStatus.lastResult.autoSubmittedApplications} auto-submitted</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Two-column action panels ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Needs Attention */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Needs Attention</div>
              <div className="card-subtitle">Blocked applications requiring your input</div>
            </div>
            <a href="/applications?status=needs_user_action" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>View all →</a>
          </div>
          <div className="divide-y">
            {attentionApps.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" />
                </svg>
                <p className="empty-state-title">Queue is clear</p>
                <p className="empty-state-body">No blocked applications right now.</p>
              </div>
            ) : attentionApps.map((app) => {
              const targetUrl = app.applyUrl ?? app.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({ status: app.status, targetUrl });
              const state = describeTrackerState(app);
              return (
                <div key={app.id} style={{ padding: "10px 16px" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex-1">
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{app.company}</div>
                      <div className="text-muted text-sm">{app.role}</div>
                    </div>
                    <StatusPill status={app.status} />
                  </div>
                  <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap" }}>
                    <span className="meta-pill">{app.source}</span>
                    <span className="meta-pill">Fit {app.fitScore}</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6 }}>{state.detail}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {canAutofill ? <AutofillLaunchForm applicationId={app.id} label={autofill.label} /> : null}
                    <a href={app.jobUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">View posting</a>
                    {app.lastAutomationUrl ? (
                      <a href={app.lastAutomationUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Open paused</a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Ready to Run */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ready to Run</div>
              <div className="card-subtitle">Prepared packets awaiting autofill</div>
            </div>
            <a href="/applications?status=prepared" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>View all →</a>
          </div>
          <div className="divide-y">
            {readyApps.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <circle cx="8" cy="8" r="6" />
                  <path strokeLinecap="round" d="M8 5v3l2 1" />
                </svg>
                <p className="empty-state-title">Nothing prepared yet</p>
                <p className="empty-state-body">Run the scraper to discover and prepare jobs.</p>
              </div>
            ) : readyApps.map((app) => {
              const targetUrl = app.applyUrl ?? app.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({ status: app.status, targetUrl });
              return (
                <div key={app.id} style={{ padding: "10px 16px" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex-1">
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{app.company}</div>
                      <div className="text-muted text-sm">{app.role}</div>
                    </div>
                    <FitBar score={app.fitScore} />
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {canAutofill ? <AutofillLaunchForm applicationId={app.id} label={autofill.label} /> : null}
                    <a href="/applications" className="btn btn-secondary btn-sm">Review</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom row ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Submitted */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recently Submitted</div>
            <a href="/applications?status=submitted" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>View all →</a>
          </div>
          <div className="divide-y">
            {submittedApps.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">No submissions yet</p>
              </div>
            ) : submittedApps.map((app) => (
              <div key={app.id} style={{ padding: "10px 16px" }} className="flex items-center gap-3">
                <div className="flex-1">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{app.company}</div>
                  <div className="text-muted text-sm">{app.role}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <StatusPill status={app.status} />
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                    {formatTimestamp(app.submittedAt ?? app.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity / Queue health */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Activity & Alerts</div>
          </div>
          <div className="divide-y">
            <div style={{ padding: "10px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Queued jobs</div>
              <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                {queuedCount === 0
                  ? "No backlog — next worker run will prepare immediately."
                  : `${queuedCount} waiting for a preparation slot.`}
              </div>
              {queuedCount > 0 ? (
                <a href="/applications?status=queued" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>View queued →</a>
              ) : null}
            </div>
            {notifications.length === 0 ? (
              <div className="empty-state" style={{ padding: "16px" }}>
                <p className="empty-state-title">No recent alerts</p>
              </div>
            ) : null}
            {notifications.slice(0, 4).map((n) => (
              <div key={n.id} style={{ padding: "10px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                <div className="text-muted text-sm" style={{ marginTop: 2 }}>{n.message}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{formatTimestamp(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

function ScraperBoardGrid({ lastResult }: { lastResult: { discoveredJobs: number } | null }) {
  const sources = [
    { key: "greenhouse", label: "Greenhouse", abbr: "GH", color: "#22c55e" },
    { key: "ashby",      label: "Ashby",      abbr: "AS", color: "#6366f1" },
    { key: "lever",      label: "Lever",      abbr: "LV", color: "#f97316" },
    { key: "workable",   label: "Workable",   abbr: "WK", color: "#0ea5e9" },
    { key: "mock",       label: "Mock/Demo",  abbr: "MK", color: "#a855f7" },
  ];

  return (
    <div className="scraper-grid">
      {sources.map((src) => (
        <div key={src.key} className="scraper-board-card">
          <div className="scraper-board-header">
            <div className="scraper-board-name">
              <div className="scraper-board-icon" style={{ background: `${src.color}18`, color: src.color, borderColor: `${src.color}30` }}>
                {src.abbr}
              </div>
              {src.label}
            </div>
          </div>
          <div className="scraper-board-meta">
            {lastResult ? (
              <>Last run found <strong>{lastResult.discoveredJobs}</strong> jobs total</>
            ) : (
              "Not yet run"
            )}
          </div>
          <form action="/api/worker/run" method="post">
            <input type="hidden" name="source" value={src.key} />
            <button type="submit" className="scraper-run-btn">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l9 5-9 5V3z" />
              </svg>
              Run {src.label}
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}

function FitBar({ score }: { score: number }) {
  const tier = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  return (
    <div style={{ minWidth: 90, textAlign: "right" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tier === "high" ? "var(--green)" : tier === "medium" ? "var(--accent-hover)" : "var(--yellow)" }}>
        {score}
      </div>
      <div style={{ height: 3, background: "var(--border-2)", borderRadius: 999, marginTop: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, background: tier === "high" ? "var(--green)" : tier === "medium" ? "var(--accent)" : "var(--yellow)", borderRadius: 999 }} />
      </div>
    </div>
  );
}
