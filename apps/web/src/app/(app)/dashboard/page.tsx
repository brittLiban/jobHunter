import { AppShell } from "@/components/app-shell";
import { AutofillLaunchForm } from "@/components/autofill-launch-form";
import { ScraperStatusPoller } from "@/components/scraper-status-poller";
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
  searchParams: Promise<{ worker?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const { overview, applications, notifications } = await loadDashboardPageData(user.id);
  const workerStatus = getWorkerStatus();

  const attentionApps = applications.filter((a) => a.status === "needs_user_action").slice(0, 6);
  const readyApps     = applications.filter((a) => a.status === "prepared").slice(0, 6);
  const submittedApps = applications.filter((a) => ["auto_submitted", "submitted"].includes(a.status)).slice(0, 6);
  const queuedCount   = applications.filter((a) => a.status === "queued").length;

  const successNotice = params.worker === "ran"
    ? "Worker cycle complete — discovery, scoring, tailoring, and preparation ran for your account."
    : null;

  return (
    <AppShell
      title="Overview"
      description="Live pipeline status and recent activity."
      userName={user.fullName ?? user.email}
      currentPath="/dashboard"
      scraperRunning={workerStatus.running}
      attentionCount={attentionApps.length}
    >
      <ScraperStatusPoller initialRunning={workerStatus.running} />

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

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Jobs Found</div>
          <div className="stat-value">{overview.jobsFound}</div>
          <div className="stat-sub">total discovered</div>
        </div>
        <div className="stat-card accent">
          <div className="stat-label">Above Threshold</div>
          <div className="stat-value">{overview.aboveThreshold}</div>
          <div className="stat-sub">strong matches</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ready to Run</div>
          <div className="stat-value">{overview.prepared}</div>
          <div className="stat-sub">prepared packets</div>
        </div>
        <div className={`stat-card${overview.needsUserAction > 0 ? " yellow" : ""}`}>
          <div className="stat-label">Needs Attention</div>
          <div className="stat-value">{overview.needsUserAction}</div>
          <div className="stat-sub">{overview.needsUserAction > 0 ? "blocked" : "queue clear"}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Submitted</div>
          <div className="stat-value">{overview.submittedTotal}</div>
          <div className="stat-sub">confirmed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Daily Cap</div>
          <div className="stat-value">
            {overview.preparedInLast24Hours}
            <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-3)" }}>/{overview.dailyTargetVolume}</span>
          </div>
          <div className="stat-sub">{overview.remainingDailyCapacity} remaining today</div>
        </div>
      </div>

      {/* Scraper control */}
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
          <div className="flex gap-2">
            <a href="/profile#boards" className="btn btn-secondary btn-sm">Configure boards</a>
            <form action="/api/worker/run" method="post">
              <button type="submit" className="btn btn-primary btn-sm">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l9 5-9 5V3z" />
                </svg>
                Run all sources
              </button>
            </form>
          </div>
        </div>
        <ScraperBoardGrid lastResult={workerStatus.lastResult} />
        {workerStatus.lastResult ? (
          <div className="card-footer">
            <span>Last run: <strong style={{ color: "var(--text)" }}>{workerStatus.lastResult.discoveredJobs}</strong> discovered</span>
            <span>{workerStatus.lastResult.scoredApplications} scored</span>
            <span>{workerStatus.lastResult.preparedApplications} prepared</span>
            {workerStatus.lastResult.autoSubmittedApplications > 0 ? (
              <span style={{ color: "var(--green)", fontWeight: 600 }}>{workerStatus.lastResult.autoSubmittedApplications} auto-submitted</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Two-column panels */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Needs Attention */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Needs Attention</div>
              <div className="card-subtitle">Blocked applications requiring input</div>
            </div>
            <a href="/applications?status=needs_user_action" className="btn btn-ghost btn-sm">View all →</a>
          </div>
          <div className="divide-y">
            {attentionApps.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" />
                </svg>
                <p className="empty-state-title">Queue clear</p>
                <p className="empty-state-body">No blocked applications right now.</p>
              </div>
            ) : attentionApps.map((app) => {
              const targetUrl = app.applyUrl ?? app.jobUrl;
              const canAutofill = supportsAutofill(targetUrl);
              const autofill = getAutofillActionSummary({ status: app.status, targetUrl });
              const state = describeTrackerState(app);
              return (
                <div key={app.id} style={{ padding: "12px 18px" }}>
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }} className="truncate">{app.company}</div>
                      <div className="text-sm text-muted truncate">{app.role}</div>
                    </div>
                    <StatusPill status={app.status} />
                  </div>
                  <div className="flex gap-1 mt-1" style={{ flexWrap: "wrap" }}>
                    <span className="meta-pill">{app.source}</span>
                    <span className="meta-pill">Fit {app.fitScore}</span>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>{state.detail}</p>
                  <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap" }}>
                    {canAutofill ? <AutofillLaunchForm applicationId={app.id} label={autofill.label} /> : null}
                    <a href={app.jobUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">View posting</a>
                    {app.lastAutomationUrl ? (
                      <a href={app.lastAutomationUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Resume paused</a>
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
            <a href="/applications?status=prepared" className="btn btn-ghost btn-sm">View all →</a>
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
                <div key={app.id} style={{ padding: "12px 18px" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }} className="truncate">{app.company}</div>
                      <div className="text-sm text-muted truncate">{app.role}</div>
                    </div>
                    <FitBar score={app.fitScore} />
                  </div>
                  <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap" }}>
                    {canAutofill ? <AutofillLaunchForm applicationId={app.id} label={autofill.label} /> : null}
                    <a href="/applications" className="btn btn-secondary btn-sm">Review</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid-2">
        {/* Recently Submitted */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recently Submitted</div>
            <a href="/applications?status=submitted" className="btn btn-ghost btn-sm">View all →</a>
          </div>
          <div className="divide-y">
            {submittedApps.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">No submissions yet</p>
              </div>
            ) : submittedApps.map((app) => (
              <div key={app.id} style={{ padding: "10px 18px" }} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">{app.company}</div>
                  <div className="text-sm text-muted truncate">{app.role}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <StatusPill status={app.status} />
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                    {formatTimestamp(app.submittedAt ?? app.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity & Alerts */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Activity & Alerts</div>
          </div>
          <div className="divide-y">
            <div style={{ padding: "12px 18px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Queued jobs</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3 }}>
                {queuedCount === 0
                  ? "No backlog — next run will prepare immediately."
                  : `${queuedCount} waiting for a preparation slot.`}
              </div>
              {queuedCount > 0 ? (
                <a href="/applications?status=queued" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>View queued →</a>
              ) : null}
            </div>
            {notifications.length === 0 ? (
              <div className="empty-state" style={{ padding: 16 }}>
                <p className="empty-state-title">No recent alerts</p>
              </div>
            ) : null}
            {notifications.slice(0, 4).map((n) => (
              <div key={n.id} style={{ padding: "10px 18px" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{n.message}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{formatTimestamp(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function ScraperBoardGrid({ lastResult }: { lastResult: { discoveredJobs: number } | null }) {
  const sources = [
    { key: "greenhouse", label: "Greenhouse",   abbr: "GH", color: "#22c55e", desc: "80+ company boards" },
    { key: "ashby",      label: "Ashby",        abbr: "AS", color: "#6366f1", desc: "30+ company boards" },
    { key: "lever",      label: "Lever",        abbr: "LV", color: "#f97316", desc: "20+ company boards" },
    { key: "workable",   label: "Workable",     abbr: "WK", color: "#0ea5e9", desc: "Company boards" },
    { key: "remoteok",   label: "RemoteOK",     abbr: "RO", color: "#10b981", desc: "300-500 remote jobs" },
    { key: "adzuna",     label: "Adzuna",       abbr: "AZ", color: "#8b5cf6", desc: "Indeed · LinkedIn · Glassdoor" },
    { key: "mock",       label: "Mock",         abbr: "MK", color: "#94a3b8", desc: "Demo data" },
  ];

  return (
    <div className="scraper-grid">
      {sources.map((src) => (
        <div key={src.key} className="scraper-board-card">
          <div className="scraper-board-header">
            <div className="scraper-board-name">
              <div
                className="scraper-board-icon"
                style={{ background: `${src.color}18`, color: src.color, borderColor: `${src.color}30` }}
              >
                {src.abbr}
              </div>
              {src.label}
            </div>
          </div>
          <div className="scraper-board-meta">
            {"desc" in src ? src.desc : ""}
            {lastResult ? <><br />Last: <strong>{lastResult.discoveredJobs}</strong> total</> : ""}
          </div>
          <form action="/api/worker/run" method="post">
            <input type="hidden" name="source" value={src.key} />
            <button type="submit" className="scraper-run-btn">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l9 5-9 5V3z" />
              </svg>
              Run
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
    <div className="fit-bar-wrap">
      <div className={`fit-score ${tier}`}>{score}</div>
      <div className="fit-bar-track" style={{ width: 72 }}>
        <div className={`fit-bar-fill ${tier}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
