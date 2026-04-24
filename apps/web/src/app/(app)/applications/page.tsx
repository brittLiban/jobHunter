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
import { matchesLocation, matchesSearch, readSearchParam } from "@/lib/list-filters";
import { loadApplicationsPageData } from "@/lib/page-data";

type Params = {
  autofill?: string; override?: string; reason?: string;
  submitted?: string; reopened?: string;
  q?: string; status?: string; locationPreset?: string; locationText?: string; focus?: string;
};

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const q              = readSearchParam(params.q);
  const statusFilter   = readSearchParam(params.status) || "actionable";
  const locationPreset = readSearchParam(params.locationPreset) || "all";
  const locationText   = readSearchParam(params.locationText);
  const focusId        = readSearchParam(params.focus);

  const applications = await loadApplicationsPageData(user.id);

  const filtered = applications.filter((a) =>
    matchesSearch([a.company, a.title, a.location, a.source], q)
    && matchApplicationStatus(a.status, statusFilter)
    && matchesLocation({ location: a.location, preset: locationPreset, customLocation: locationText }),
  );

  const focusPool = statusFilter === "actionable"
    ? (filtered.filter((a) => ["prepared", "needs_user_action", "queued"].includes(a.status)).length > 0
      ? filtered.filter((a) => ["prepared", "needs_user_action", "queued"].includes(a.status))
      : filtered)
    : filtered;

  const focused      = focusPool.find((a) => a.id === focusId) ?? focusPool[0] ?? null;
  const focusedIdx   = focused ? focusPool.findIndex((a) => a.id === focused.id) : -1;
  const prev         = focusedIdx > 0 ? focusPool[focusedIdx - 1] : null;
  const next         = focusedIdx >= 0 && focusedIdx < focusPool.length - 1 ? focusPool[focusedIdx + 1] : null;

  const readyCount    = filtered.filter((a) => a.status === "prepared").length;
  const attentionCount = filtered.filter((a) => a.status === "needs_user_action").length;
  const submittedCount = filtered.filter((a) => ["auto_submitted", "submitted"].includes(a.status)).length;

  const notice = buildNotice(params);

  return (
    <AppShell
      title="Review Queue"
      description="Inspect prepared packets, edit answers, and launch autofill."
      userName={user.fullName ?? user.email}
      currentPath="/applications"
      attentionCount={attentionCount}
    >
      {notice ? (
        <div className={`notice notice-${notice.tone}`}>
          <div>
            <p className="notice-title">{notice.title}</p>
            <p className="notice-body">{notice.message}</p>
          </div>
        </div>
      ) : null}

      {/* Metrics */}
      <div className="metrics-strip" style={{ marginBottom: 16 }}>
        <div className="metric-card"><div className="metric-label">In view</div><div className="metric-value">{filtered.length}</div></div>
        <div className="metric-card accent"><div className="metric-label">Ready</div><div className="metric-value">{readyCount}</div></div>
        {attentionCount > 0 ? (
          <div className="metric-card yellow"><div className="metric-label">Attention</div><div className="metric-value">{attentionCount}</div></div>
        ) : (
          <div className="metric-card"><div className="metric-label">Attention</div><div className="metric-value">0</div></div>
        )}
        <div className="metric-card green"><div className="metric-label">Submitted</div><div className="metric-value">{submittedCount}</div></div>
      </div>

      {/* Filters */}
      <form action="/applications" method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Search</label>
          <input className="form-input" name="q" defaultValue={q} placeholder="Company or role…" style={{ height: 30, padding: "0 8px" }} />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Status</label>
          <select className="form-select" name="status" defaultValue={statusFilter} style={{ height: 30, padding: "0 8px" }}>
            <option value="actionable">Actionable</option>
            <option value="prepared">Ready to run</option>
            <option value="needs_user_action">Needs attention</option>
            <option value="queued">Queued</option>
            <option value="submitted">Submitted</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">Location</label>
          <select className="form-select" name="locationPreset" defaultValue={locationPreset} style={{ height: 30, padding: "0 8px" }}>
            <option value="all">All</option>
            <option value="greater_seattle">Seattle Area</option>
            <option value="remote">Remote</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <button type="submit" className="btn btn-primary btn-sm">Filter</button>
          <a href="/applications" className="btn btn-secondary btn-sm">Reset</a>
        </div>
      </form>

      {/* Split panel */}
      <div className="review-layout">
        {/* Rail */}
        <aside className="review-rail">
          <div className="review-rail-header">
            <span>{focusPool.length} application{focusPool.length === 1 ? "" : "s"}</span>
            {focusedIdx >= 0 ? <span style={{ color: "var(--text-3)" }}>{focusedIdx + 1}/{focusPool.length}</span> : null}
          </div>
          {focusPool.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No matches</p>
              <p className="empty-state-body">Try a different status filter.</p>
            </div>
          ) : null}
          {focusPool.map((app) => {
            const score = app.fitScore;
            const tier = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
            return (
              <a
                key={app.id}
                href={buildFocusUrl(params, q, statusFilter, locationPreset, locationText, app.id)}
                className={`review-rail-item${focused?.id === app.id ? " active" : ""}`}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rail-company truncate">{app.company}</div>
                    <div className="rail-title truncate">{app.title}</div>
                  </div>
                  <StatusPill status={app.status} />
                </div>
                <div className="rail-meta">
                  <span className="rail-fit">{score !== null ? `${score} fit` : "–"}</span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>·</span>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{app.location || "–"}</span>
                </div>
                {score !== null ? (
                  <div style={{ height: 2, background: "var(--border-2)", borderRadius: 999, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${score}%`, background: tier === "high" ? "var(--green)" : tier === "medium" ? "var(--accent)" : "var(--yellow)", borderRadius: 999 }} />
                  </div>
                ) : null}
              </a>
            );
          })}
        </aside>

        {/* Detail panel */}
        <div className="review-detail">
          {!focused ? (
            <div className="empty-state" style={{ height: "100%", justifyContent: "center" }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" width="32" height="32">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 4h12M2 8h8M2 12h6" />
              </svg>
              <p className="empty-state-title">Select an application</p>
              <p className="empty-state-body">Click any item in the list to review its details.</p>
            </div>
          ) : (
            <>
              <div className="review-detail-header">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div className="review-detail-company">{focused.company}</div>
                    <div className="review-detail-role">{focused.title}</div>
                  </div>
                  <StatusPill status={focused.status} />
                </div>
                <div className="review-detail-meta-row">
                  {focused.location ? <span className="meta-pill">{focused.location}</span> : null}
                  <span className="meta-pill">{focused.source}</span>
                  {focused.seniority ? <span className="meta-pill">{capitalize(focused.seniority)} level</span> : null}
                  {focused.fitScore !== null ? (
                    <span className="meta-pill" style={{ color: focused.fitScore >= 80 ? "var(--green)" : focused.fitScore >= 60 ? "var(--accent-hover)" : "var(--yellow)", fontWeight: 700 }}>
                      Fit {focused.fitScore}/100
                    </span>
                  ) : null}
                  {focused.scoreConfidence !== null ? (
                    <span className="meta-pill">{Math.round((focused.scoreConfidence ?? 0) * 100)}% confidence</span>
                  ) : null}
                </div>
                {/* Status detail */}
                {(() => {
                  const state = describeTrackerState(focused);
                  return (
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8 }}>
                      <strong style={{ color: "var(--text)" }}>{state.label}</strong> — {state.detail}
                    </p>
                  );
                })()}
              </div>

              <div className="review-detail-body">
                {/* Fit assessment */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="inset-panel">
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Top Matches</div>
                    {focused.topMatches.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-3)" }}>No fit data yet.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {focused.topMatches.map((m: string) => (
                          <div key={m} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ color: "var(--green)", fontSize: 10 }}>✓</span> {m}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="inset-panel">
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Gaps</div>
                    {focused.majorGaps.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text-3)" }}>No major gaps.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {focused.majorGaps.map((g: string) => (
                          <div key={g} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ color: "var(--yellow)", fontSize: 10 }}>△</span> {g}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Prepared materials */}
                <div className="inset-panel">
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Prepared Materials</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                    <span><strong style={{ color: "var(--text)" }}>{focused.generatedAnswers.length}</strong> short answers</span>
                    <span style={{ color: "var(--text-3)" }}>Updated {formatTimestamp(focused.updatedAt)}</span>
                  </div>
                  {focused.generatedAnswers.length > 0 ? (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {focused.generatedAnswers.map((ans, i) => (
                        <div key={i} className="field-answer-row">
                          <div className="field-answer-label">{ans.kind.replace(/_/g, " ")}</div>
                          <div className="field-answer-value">{ans.answer}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Autofill progress + unresolved questions */}
                {focused.automationSummary && (focused.automationSummary.filledFieldCount > 0 || focused.automationSummary.unknownRequiredFields.length > 0) ? (
                  <div className="inset-panel">
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Autofill Progress
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>
                      Last run filled <strong>{focused.automationSummary.filledFieldCount}</strong> field{focused.automationSummary.filledFieldCount === 1 ? "" : "s"}.
                      {focused.automationSummary.unknownRequiredFields.length > 0
                        ? ` ${focused.automationSummary.unknownRequiredFields.length} required question${focused.automationSummary.unknownRequiredFields.length === 1 ? "" : "s"} unresolved.`
                        : " All required fields resolved."}
                    </p>
                    {focused.automationSummary.unknownRequiredFields.map((field: string) => {
                      const saved = getSavedOverride(focused.preparedPayload, field);
                      const suggested = getSuggestedAnswer(focused.automationSummary, field);
                      return (
                        <form
                          key={field}
                          action={`/api/applications/${focused.id}/field-overrides`}
                          method="post"
                          style={{ display: "grid", gap: 6, marginBottom: 10, padding: "10px", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "var(--r-md)" }}
                        >
                          <input type="hidden" name="label" value={field} />
                          <div className="form-field">
                            <label className="form-label">{field}</label>
                            <input className="form-input" name="value" defaultValue={saved || suggested} placeholder="Your answer…" style={{ fontSize: 12 }} />
                          </div>
                          {!saved && suggested ? <p style={{ fontSize: 11, color: "var(--text-3)" }}>AI suggestion prefilled. Edit if needed.</p> : null}
                          <button type="submit" className="btn btn-secondary btn-sm" style={{ justifySelf: "end" }}>Save answer</button>
                        </form>
                      );
                    })}
                  </div>
                ) : null}

                {/* Latest event */}
                {focused.events[0] ? (
                  <div className="inset-panel">
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Latest Event</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{focused.events[0].title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{focused.events[0].detail ?? focused.events[0].type}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{formatTimestamp(focused.events[0].createdAt)}</div>
                  </div>
                ) : null}
              </div>

              {/* Actions */}
              <div className="review-detail-actions">
                {renderAutofillAction(focused)}
                {focused.applyUrl ? (
                  <a href={buildExtensionUrl(focused.applyUrl, focused.id)} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">
                    Open + Extension Autofill
                  </a>
                ) : null}
                {focused.applyUrl ? (
                  <a href={focused.applyUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Application form</a>
                ) : null}
                <a href={focused.jobUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Job posting</a>
                {focused.lastAutomationUrl ? (
                  <a href={focused.lastAutomationUrl} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">Paused page</a>
                ) : null}
                {focused.status === "needs_user_action" ? (
                  <form action={`/api/applications/${focused.id}/reopen`} method="post">
                    <button type="submit" className="btn btn-secondary btn-sm">Requeue</button>
                  </form>
                ) : null}
                {!["auto_submitted", "submitted", "skipped", "rejected", "offer"].includes(focused.status) ? (
                  <form action={`/api/applications/${focused.id}/mark-submitted`} method="post">
                    <button type="submit" className="btn btn-ghost btn-sm">Mark submitted</button>
                  </form>
                ) : null}
              </div>

              {/* Navigation */}
              <div className="review-nav">
                {prev ? (
                  <a href={buildFocusUrl(params, q, statusFilter, locationPreset, locationText, prev.id)} className="btn btn-ghost btn-sm">← Prev</a>
                ) : <span />}
                <span>{focusedIdx + 1} of {focusPool.length}</span>
                {next ? (
                  <a href={buildFocusUrl(params, q, statusFilter, locationPreset, locationText, next.id)} className="btn btn-ghost btn-sm">Next →</a>
                ) : <span />}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ── Helpers ────────────────────────────────────────────── */

function renderAutofillAction(app: { id: string; status: string; applyUrl?: string | null; jobUrl: string }) {
  const url = app.applyUrl ?? app.jobUrl;
  if (!["prepared", "needs_user_action"].includes(app.status) || !supportsAutofill(url)) return null;
  const autofill = getAutofillActionSummary({ status: app.status, targetUrl: url });
  return <AutofillLaunchForm applicationId={app.id} label={autofill.label} />;
}

function buildExtensionUrl(url: string, appId: string) {
  try {
    const p = new URL(url);
    p.searchParams.set("jhApplicationId", appId);
    p.searchParams.set("jhRefresh", "1");
    return p.toString();
  } catch {
    return url;
  }
}

function buildFocusUrl(params: Params, q: string, status: string, locationPreset: string, locationText: string, focus: string) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (status) p.set("status", status);
  if (locationPreset !== "all") p.set("locationPreset", locationPreset);
  if (locationText) p.set("locationText", locationText);
  p.set("focus", focus);
  return `/applications?${p.toString()}`;
}

function matchApplicationStatus(status: string, filter: string) {
  if (!filter || filter === "actionable") return ["prepared", "needs_user_action", "queued"].includes(status);
  if (filter === "submitted") return ["submitted", "auto_submitted"].includes(status);
  if (filter === "all") return true;
  return status === filter;
}

function getSavedOverride(payload: unknown, label: string) {
  if (!isRecord(payload) || !isRecord(payload.fieldOverrides)) return "";
  const key = normalizeKey(label);
  const v = (payload.fieldOverrides as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

function getSuggestedAnswer(summary: unknown, label: string) {
  if (!isRecord(summary) || !isRecord(summary.suggestedFieldAnswers)) return "";
  const key = normalizeKey(label);
  const v = (summary.suggestedFieldAnswers as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

function normalizeKey(label: string) { return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null; }
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function buildNotice(params: Params): { tone: "success" | "info" | "warning"; title: string; message: string } | null {
  if (params.override === "1") return { tone: "success", title: "Answer saved", message: "Will be reused on the next autofill run." };
  if (params.submitted === "1") return { tone: "success", title: "Marked submitted", message: "Application is now tracked as complete." };
  if (params.reopened === "1") return { tone: "info", title: "Requeued", message: "Application moved back into the preparation queue." };
  if (params.autofill === "blocked") return { tone: "warning", title: "Autofill blocked", message: params.reason ?? "Could not open the application for autofill." };
  if (params.autofill === "auto_submitted") return { tone: "success", title: "Auto-submitted", message: "Autofill reached a confirmed submit state." };
  if (params.autofill === "needs_user_action") return { tone: "info", title: "Autofill paused", message: "Moved to Needs Attention — open the paused page to continue." };
  return null;
}
