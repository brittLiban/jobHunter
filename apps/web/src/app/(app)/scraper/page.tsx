import { AppShell } from "@/components/app-shell";
import { ScraperStatusPoller } from "@/components/scraper-status-poller";
import { requireOnboardedUser } from "@/lib/auth";
import { formatTimestamp } from "@/lib/application-presentation";
import { loadProfilePageData } from "@/lib/page-data";
import { getWorkerStatus } from "@/lib/worker-state";
import type { StructuredProfile } from "@jobhunter/core";

function listValue(arr: string[] | undefined) {
  return arr && arr.length > 0 ? arr.join(", ") : "";
}

export default async function ScraperPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const saved = params.saved;

  const bundle = await loadProfilePageData(user.id);
  const profile = (bundle?.profile ?? {}) as Partial<StructuredProfile> & { email?: string };
  const prefs = bundle?.preferences ?? {};
  const workerStatus = getWorkerStatus();

  const seniority = new Set(prefs.seniorityTargets?.length ? prefs.seniorityTargets : ["entry", "mid"]);
  const workModes = new Set(prefs.workModes?.length ? prefs.workModes : ["remote", "hybrid"]);

  /* Carry all unchanged settings through the save so nothing gets wiped */
  const sources = new Set(prefs.sourceKinds?.length ? prefs.sourceKinds : ["greenhouse", "ashby", "lever", "workable", "remoteok", "adzuna"]);

  return (
    <AppShell
      title="Scraper"
      description="Set what you're looking for and run."
      userName={user.fullName ?? user.email}
      currentPath="/scraper"
      scraperRunning={workerStatus.running}
    >
      <ScraperStatusPoller initialRunning={workerStatus.running} />

      {saved ? (
        <div className="notice notice-success" style={{ marginBottom: 16 }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" />
          </svg>
          <div>
            <p className="notice-title">Saved — ready to run</p>
            <p className="notice-body">Hit Run to start discovering jobs with your updated settings.</p>
          </div>
        </div>
      ) : null}

      {/* Main config + run card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-title">What are you looking for?</div>
            <div className="card-subtitle">
              {workerStatus.running ? (
                <span style={{ color: "var(--yellow)" }}>● Scraper is running…</span>
              ) : workerStatus.lastRanAt ? (
                `Last ran ${formatTimestamp(workerStatus.lastRanAt)}${workerStatus.lastResult ? ` · ${workerStatus.lastResult.discoveredJobs} jobs found, ${workerStatus.lastResult.preparedApplications} prepared` : ""}`
              ) : (
                "Configure below and hit Run."
              )}
            </div>
          </div>
        </div>

        <form action="/api/profile" method="post">
          {/* Carry all other settings unchanged */}
          <input type="hidden" name="returnTo" value="/scraper" />
          <input type="hidden" name="fullLegalName"           value={profile.fullLegalName ?? user.fullName ?? ""} />
          <input type="hidden" name="email"                   value={profile.email ?? user.email} />
          <input type="hidden" name="phone"                   value={profile.phone ?? ""} />
          <input type="hidden" name="city"                    value={profile.city ?? ""} />
          <input type="hidden" name="state"                   value={profile.state ?? ""} />
          <input type="hidden" name="country"                 value={profile.country ?? "United States"} />
          <input type="hidden" name="workAuthorization"       value={profile.workAuthorization ?? ""} />
          <input type="hidden" name="usCitizenStatus"         value={profile.usCitizenStatus ?? ""} />
          <input type="hidden" name="requiresVisaSponsorship" value={String(profile.requiresVisaSponsorship ?? false)} />
          <input type="hidden" name="veteranStatus"           value={profile.veteranStatus ?? ""} />
          <input type="hidden" name="gender"                  value={profile.gender ?? ""} />
          <input type="hidden" name="ethnicity"               value={profile.ethnicity ?? ""} />
          <input type="hidden" name="school"                  value={profile.school ?? ""} />
          <input type="hidden" name="degree"                  value={profile.degree ?? ""} />
          <input type="hidden" name="graduationDate"          value={profile.graduationDate ?? "2025-01-01"} />
          <input type="hidden" name="yearsOfExperience"       value={String(profile.yearsOfExperience ?? 0)} />
          <input type="hidden" name="currentCompany"          value={profile.currentCompany ?? ""} />
          <input type="hidden" name="currentTitle"            value={profile.currentTitle ?? ""} />
          <input type="hidden" name="disabilityStatus"        value={profile.disabilityStatus ?? ""} />
          <input type="hidden" name="linkedinUrl"             value={profile.linkedinUrl ?? ""} />
          <input type="hidden" name="githubUrl"               value={profile.githubUrl ?? ""} />
          <input type="hidden" name="portfolioUrl"            value={profile.portfolioUrl ?? ""} />
          <input type="hidden" name="llmProvider"             value={prefs.llmProvider ?? ""} />
          <input type="hidden" name="llmModel"                value={prefs.llmModel ?? ""} />
          <input type="hidden" name="llmBaseUrl"              value={prefs.llmBaseUrl ?? ""} />
          <input type="hidden" name="llmApiKey"               value={prefs.llmApiKey ?? ""} />
          <input type="hidden" name="fitThreshold"            value={String(prefs.fitThreshold ?? 70)} />
          <input type="hidden" name="dailyTargetVolume"       value={String(prefs.dailyTargetVolume ?? 15)} />
          <input type="hidden" name="includeKeywords"         value={listValue(prefs.includeKeywords)} />
          <input type="hidden" name="excludeKeywords"         value={listValue(prefs.excludeKeywords)} />
          <input type="hidden" name="greenhouseBoards"        value={listValue((prefs as Record<string,unknown>).greenhouseBoards as string[] | undefined)} />
          <input type="hidden" name="ashbyBoards"             value={listValue((prefs as Record<string,unknown>).ashbyBoards as string[] | undefined)} />
          <input type="hidden" name="leverBoards"             value={listValue((prefs as Record<string,unknown>).leverBoards as string[] | undefined)} />
          <input type="hidden" name="workableBoards"          value={listValue((prefs as Record<string,unknown>).workableBoards as string[] | undefined)} />
          {/* Always enable all useful sources */}
          {[...sources].map((v) => <input key={v} type="hidden" name="sourceKinds" value={v} />)}

          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Role */}
            <div className="form-field">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Role</label>
              <input
                className="form-input"
                name="targetRoles"
                defaultValue={listValue(prefs.targetRoles) || "Software Engineer"}
                placeholder="Software Engineer"
                style={{ fontSize: 15 }}
              />
              <span className="form-hint">What job title(s) are you targeting? Comma-separate multiple roles.</span>
            </div>

            {/* Location */}
            <div className="form-field">
              <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Where</label>
              <input
                className="form-input"
                name="locations"
                defaultValue={listValue(prefs.locations) || "Remote"}
                placeholder="Remote, Seattle, WA"
                style={{ fontSize: 15 }}
              />
              <span className="form-hint">
                <strong>Remote</strong> = any remote job worldwide. &nbsp;
                <strong>Remote, United States</strong> = US-only remote. &nbsp;
                <strong>Seattle, WA</strong> = Greater Seattle metro. &nbsp;
                Comma-separate for multiple.
              </span>
            </div>

            {/* Level + Work mode on one row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div className="form-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Level</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { value: "entry",  label: "Entry" },
                    { value: "mid",    label: "Mid" },
                    { value: "senior", label: "Senior" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: "999px", background: seniority.has(opt.value) ? "var(--accent-light)" : "var(--surface)", cursor: "pointer", fontSize: 13 }}>
                      <input type="checkbox" name="seniorityTargets" value={opt.value} defaultChecked={seniority.has(opt.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="form-label" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Work mode</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { value: "remote",   label: "Remote" },
                    { value: "hybrid",   label: "Hybrid" },
                    { value: "on_site",  label: "On-site" },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: "999px", background: workModes.has(opt.value) ? "var(--accent-light)" : "var(--surface)", cursor: "pointer", fontSize: 13 }}>
                      <input type="checkbox" name="workModes" value={opt.value} defaultChecked={workModes.has(opt.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 16, display: "flex", gap: 10 }}>
              <button type="submit" className="btn btn-secondary">Save</button>
            </div>
          </div>
        </form>
      </div>

      {/* Last run results */}
      {workerStatus.lastResult && !workerStatus.running ? (
        <div className="notice notice-success" style={{ marginBottom: 16 }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" />
          </svg>
          <div style={{ flex: 1 }}>
            <p className="notice-title">Last run complete</p>
            <p className="notice-body">
              {workerStatus.lastResult.discoveredJobs} jobs discovered &nbsp;·&nbsp;
              {workerStatus.lastResult.scoredApplications} scored &nbsp;·&nbsp;
              <strong>{workerStatus.lastResult.preparedApplications} prepared</strong>
              {workerStatus.lastResult.needsUserActionApplications > 0 ? ` · ${workerStatus.lastResult.needsUserActionApplications} need your attention` : ""}
            </p>
          </div>
          <div className="flex gap-2" style={{ flexShrink: 0 }}>
            <a href="/applications" className="btn btn-primary btn-sm">View applications →</a>
            <a href="/dashboard" className="btn btn-secondary btn-sm">Dashboard</a>
          </div>
        </div>
      ) : null}

      {/* Run */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Run the scraper</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              Searches Greenhouse, Ashby, Lever, Workable, RemoteOK, and Adzuna (Indeed · LinkedIn · Glassdoor) using your settings above. The AI scores each match and prepares your top applications.
            </div>
          </div>
          <form action="/api/worker/run" method="post" style={{ flexShrink: 0 }}>
            <input type="hidden" name="returnTo" value="/scraper" />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={workerStatus.running}
              style={{ fontSize: 15, padding: "10px 24px", minWidth: 140 }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l9 5-9 5V3z" />
              </svg>
              {workerStatus.running ? "Running…" : "Run now"}
            </button>
          </form>
        </div>
      </div>

      {/* Advanced link */}
      <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
        Need to tweak ATS boards, keywords, fit threshold, or AI engine? &nbsp;
        <a href="/profile?tab=discovery" style={{ color: "var(--accent)" }}>Advanced settings →</a>
      </div>
    </AppShell>
  );
}
