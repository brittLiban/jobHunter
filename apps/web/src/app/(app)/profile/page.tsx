import { AppShell } from "@/components/app-shell";
import { ExtensionTokenManager } from "@/components/extension-token-manager";
import { requireOnboardedUser } from "@/lib/auth";
import { loadProfilePageData } from "@/lib/page-data";
import { listExtensionTokensForUser } from "@jobhunter/db";

function listValue(arr: string[] | undefined) {
  return arr && arr.length > 0 ? arr.join(", ") : "";
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const tab = params.tab ?? "identity";
  const saved = params.saved;

  const bundle = await loadProfilePageData(user.id);
  const extensionTokens = await listExtensionTokensForUser(user.id);

  const profile = bundle?.profile ?? {};
  const prefs = bundle?.preferences ?? {};

  const workModes     = new Set(prefs.workModes?.length ? prefs.workModes : ["remote", "hybrid"]);
  const seniority     = new Set(prefs.seniorityTargets?.length ? prefs.seniorityTargets : ["entry", "mid"]);
  const sources       = new Set(prefs.sourceKinds?.length ? prefs.sourceKinds : ["greenhouse", "ashby", "lever", "workable", "mock"]);

  /* Shared hidden fields to carry all other sections on partial saves */
  const identityHidden = (
    <>
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
      <input type="hidden" name="school"                  value={profile.school ?? ""} />
      <input type="hidden" name="degree"                  value={profile.degree ?? ""} />
      <input type="hidden" name="graduationDate"          value={profile.graduationDate ?? "2025-01-01"} />
      <input type="hidden" name="yearsOfExperience"       value={String(profile.yearsOfExperience ?? 0)} />
      <input type="hidden" name="currentCompany"          value={profile.currentCompany ?? ""} />
      <input type="hidden" name="currentTitle"            value={profile.currentTitle ?? ""} />
    </>
  );

  const discoveryHidden = (
    <>
      <input type="hidden" name="targetRoles"        value={listValue(prefs.targetRoles) || "Software Engineer"} />
      <input type="hidden" name="locations"          value={listValue(prefs.locations) || "Remote"} />
      <input type="hidden" name="fitThreshold"       value={String(prefs.fitThreshold ?? 70)} />
      <input type="hidden" name="dailyTargetVolume"  value={String(prefs.dailyTargetVolume ?? 15)} />
      <input type="hidden" name="includeKeywords"    value={listValue(prefs.includeKeywords)} />
      <input type="hidden" name="excludeKeywords"    value={listValue(prefs.excludeKeywords)} />
      {[...workModes].map((v) => <input key={v} type="hidden" name="workModes" value={v} />)}
      {[...seniority].map((v) => <input key={v} type="hidden" name="seniorityTargets" value={v} />)}
      {[...sources].map((v)   => <input key={v} type="hidden" name="sourceKinds" value={v} />)}
    </>
  );

  const boardsHidden = (
    <>
      <input type="hidden" name="greenhouseBoards" value={listValue(prefs.greenhouseBoards)} />
      <input type="hidden" name="ashbyBoards"      value={listValue(prefs.ashbyBoards)} />
      <input type="hidden" name="leverBoards"      value={listValue(prefs.leverBoards)} />
      <input type="hidden" name="workableBoards"   value={listValue(prefs.workableBoards)} />
    </>
  );

  const llmHidden = (
    <>
      <input type="hidden" name="llmProvider" value={prefs.llmProvider ?? ""} />
      <input type="hidden" name="llmModel"    value={prefs.llmModel ?? ""} />
      <input type="hidden" name="llmBaseUrl"  value={prefs.llmBaseUrl ?? ""} />
      <input type="hidden" name="llmApiKey"   value={prefs.llmApiKey ?? ""} />
    </>
  );

  const tabs = [
    { key: "identity",  label: "Identity" },
    { key: "discovery", label: "Discovery" },
    { key: "ai",        label: "AI Engine" },
    { key: "boards",    label: "Job Boards" },
    { key: "extension", label: "Extension" },
  ] as const;

  return (
    <AppShell
      title="Settings"
      description="Configure your profile, discovery controls, AI engine, and extension."
      userName={user.fullName ?? user.email}
      currentPath="/profile"
      llmProvider={prefs.llmProvider ?? null}
    >
      {saved ? (
        <div className="notice notice-success" style={{ marginBottom: 16 }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 4L6 11 3 8" /></svg>
          <div><p className="notice-title">Saved</p><p className="notice-body">Your settings were updated successfully.</p></div>
        </div>
      ) : null}

      {/* Tab bar */}
      <div className="tabs">
        {tabs.map((t) => (
          <a key={t.key} href={`/profile?tab=${t.key}`} className={`tab${tab === t.key ? " active" : ""}`}>
            {t.label}
          </a>
        ))}
      </div>

      {/* ── Identity ─────────────────────────────────────── */}
      {tab === "identity" && (
        <form action="/api/profile" method="post">
          {discoveryHidden}{boardsHidden}{llmHidden}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Identity &amp; Work Authorization</div>
                <div className="card-subtitle">Your legal name and employment eligibility — used to fill application forms.</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Personal */}
              <div>
                <div className="form-section-title">Personal</div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <SettingsField label="Full legal name" name="fullLegalName" defaultValue={profile.fullLegalName} required />
                  <SettingsField label="Email" name="email" type="email" defaultValue={profile.email ?? user.email} required />
                  <SettingsField label="Phone" name="phone" defaultValue={profile.phone} placeholder="+1 555 000 0000" required />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <SettingsField label="City" name="city" defaultValue={profile.city} required />
                    <SettingsField label="State" name="state" defaultValue={profile.state} placeholder="WA" />
                    <SettingsField label="Country" name="country" defaultValue={profile.country ?? "United States"} required />
                  </div>
                  <SettingsField label="LinkedIn URL" name="linkedinUrl" defaultValue={profile.linkedinUrl} placeholder="https://linkedin.com/in/…" />
                  <SettingsField label="GitHub URL" name="githubUrl" defaultValue={profile.githubUrl} placeholder="https://github.com/…" />
                  <SettingsField label="Portfolio URL" name="portfolioUrl" defaultValue={profile.portfolioUrl} placeholder="https://…" />
                </div>
              </div>

              {/* Authorization */}
              <div>
                <div className="form-section-title">Work Authorization</div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <SettingsField label="Work authorization" name="workAuthorization" defaultValue={profile.workAuthorization} placeholder="Authorized to work in US" required />
                  <SettingsField label="Citizenship status" name="usCitizenStatus" defaultValue={profile.usCitizenStatus} placeholder="US Citizen" required />
                  <SettingsSelect label="Requires visa sponsorship" name="requiresVisaSponsorship" defaultValue={String(profile.requiresVisaSponsorship ?? false)}>
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </SettingsSelect>
                  <SettingsField label="Veteran status" name="veteranStatus" defaultValue={profile.veteranStatus} placeholder="Not a veteran" required />
                  <SettingsField label="Disability status" name="disabilityStatus" defaultValue={profile.disabilityStatus} placeholder="No disability" />
                </div>
              </div>

              {/* Education & Experience */}
              <div>
                <div className="form-section-title">Education &amp; Experience</div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <SettingsField label="School" name="school" defaultValue={profile.school} required />
                  <SettingsField label="Degree" name="degree" defaultValue={profile.degree} placeholder="B.S. Computer Science" required />
                  <SettingsField label="Graduation date" name="graduationDate" type="date" defaultValue={profile.graduationDate} required />
                  <SettingsField label="Years of experience" name="yearsOfExperience" type="number" defaultValue={String(profile.yearsOfExperience ?? "")} />
                  <SettingsField label="Current company" name="currentCompany" defaultValue={profile.currentCompany} />
                  <SettingsField label="Current title" name="currentTitle" defaultValue={profile.currentTitle} />
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
                <button type="submit" className="btn btn-primary">Save identity</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ── Discovery ────────────────────────────────────── */}
      {tab === "discovery" && (
        <form action="/api/profile" method="post">
          {identityHidden}{boardsHidden}{llmHidden}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Discovery Controls</div>
              <div className="card-subtitle">Rules that determine which jobs the scraper keeps and how many it prepares per day.</div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Targeting */}
              <div>
                <div className="form-section-title">Targeting</div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <SettingsField label="Target roles" name="targetRoles" defaultValue={listValue(prefs.targetRoles) || "Software Engineer"} placeholder="Software Engineer, Backend Engineer" hint="Comma-separated. Matched against job titles." />
                  <SettingsField label="Target locations" name="locations" defaultValue={listValue(prefs.locations) || "Remote"} placeholder="Seattle, Remote, New York" hint="Comma-separated location strings." />
                  <SettingsField label="Include keywords" name="includeKeywords" defaultValue={listValue(prefs.includeKeywords)} placeholder="React, TypeScript, Node.js" hint="Jobs must contain at least one." />
                  <SettingsField label="Exclude keywords" name="excludeKeywords" defaultValue={listValue(prefs.excludeKeywords)} placeholder="PHP, Rails" hint="Jobs containing these are filtered out." />
                </div>
              </div>

              {/* Volume */}
              <div>
                <div className="form-section-title">Volume &amp; Thresholds</div>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <SettingsField label="Fit threshold" name="fitThreshold" type="number" defaultValue={String(prefs.fitThreshold ?? 70)} hint="0–100. Jobs scoring below this are skipped." />
                  <SettingsField label="Daily target (applications)" name="dailyTargetVolume" type="number" defaultValue={String(prefs.dailyTargetVolume ?? 15)} hint="Max applications to prepare per 24h window." />
                </div>
              </div>

              {/* Work mode */}
              <div>
                <div className="form-section-title" style={{ marginBottom: 12 }}>Work Mode</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { value: "remote",  label: "Remote" },
                    { value: "hybrid",  label: "Hybrid" },
                    { value: "on_site", label: "On-site" },
                    { value: "flexible",label: "Flexible" },
                  ].map((opt) => (
                    <label key={opt.value} className="checkbox-field" style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "999px", background: workModes.has(opt.value) ? "var(--accent-light)" : "var(--surface)" }}>
                      <input type="checkbox" name="workModes" value={opt.value} defaultChecked={workModes.has(opt.value)} />
                      <span style={{ fontSize: 13 }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Seniority */}
              <div>
                <div className="form-section-title" style={{ marginBottom: 12 }}>Seniority Targets</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { value: "entry",  label: "Entry" },
                    { value: "mid",    label: "Mid" },
                    { value: "senior", label: "Senior" },
                  ].map((opt) => (
                    <label key={opt.value} className="checkbox-field" style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "999px", background: seniority.has(opt.value) ? "var(--accent-light)" : "var(--surface)" }}>
                      <input type="checkbox" name="seniorityTargets" value={opt.value} defaultChecked={seniority.has(opt.value)} />
                      <span style={{ fontSize: 13 }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sources */}
              <div>
                <div className="form-section-title" style={{ marginBottom: 12 }}>Enabled Sources</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { value: "greenhouse", label: "Greenhouse" },
                    { value: "ashby",      label: "Ashby" },
                    { value: "lever",      label: "Lever" },
                    { value: "workable",   label: "Workable" },
                    { value: "mock",       label: "Mock/Demo" },
                  ].map((opt) => (
                    <label key={opt.value} className="checkbox-field" style={{ padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "999px", background: sources.has(opt.value) ? "var(--accent-light)" : "var(--surface)" }}>
                      <input type="checkbox" name="sourceKinds" value={opt.value} defaultChecked={sources.has(opt.value)} />
                      <span style={{ fontSize: 13 }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
                <button type="submit" className="btn btn-primary">Save discovery settings</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ── AI Engine ────────────────────────────────────── */}
      {tab === "ai" && (
        <form action="/api/profile" method="post">
          {identityHidden}{discoveryHidden}{boardsHidden}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">AI Engine</div>
                <div className="card-subtitle">Override the environment LLM. Leave blank to use <code>OLLAMA_URL</code>, <code>OPENAI_API_KEY</code>, or <code>ANTHROPIC_API_KEY</code>.</div>
              </div>
              {prefs.llmProvider ? (
                <span className="badge badge-prepared">{prefs.llmProvider} (custom)</span>
              ) : (
                <span className="badge badge-default">Using env defaults</span>
              )}
            </div>
            <div className="card-body">
              <div className="notice notice-info" style={{ marginBottom: 16 }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path strokeLinecap="round" d="M8 7v4M8 5.5v.5" /></svg>
                <div>
                  <p className="notice-title">Ollama is the default open-source LLM</p>
                  <p className="notice-body">Your Docker stack already includes Ollama running <strong>qwen2.5:7b</strong>. No API key needed. Set OpenAI or Anthropic keys below only if you want to switch to a paid model.</p>
                </div>
              </div>
              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label">Provider override</label>
                  <select className="form-select" name="llmProvider" defaultValue={prefs.llmProvider ?? ""}>
                    <option value="">Use environment (Ollama default)</option>
                    <option value="ollama">Ollama (local)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </div>
                <SettingsField
                  label="Model name"
                  name="llmModel"
                  defaultValue={prefs.llmModel}
                  placeholder="qwen2.5:7b, gpt-4o-mini, claude-haiku-4-5-20251001"
                  hint="Leave blank to use the provider's default."
                />
                <SettingsField
                  label="API key"
                  name="llmApiKey"
                  type="password"
                  defaultValue={prefs.llmApiKey}
                  placeholder="sk-… or ant-… (leave blank for Ollama)"
                  hint="Only needed for OpenAI or Anthropic."
                />
                <SettingsField
                  label="Ollama base URL"
                  name="llmBaseUrl"
                  defaultValue={prefs.llmBaseUrl}
                  placeholder="http://localhost:11434"
                  hint="Default points to the Docker Ollama service."
                />
              </div>
              <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14, marginTop: 14 }}>
                <button type="submit" className="btn btn-primary">Save AI engine</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ── Job Boards ───────────────────────────────────── */}
      {tab === "boards" && (
        <form action="/api/profile" method="post" id="boards">
          {identityHidden}{discoveryHidden}{llmHidden}
          <div className="card">
            <div className="card-header">
              <div className="card-title">Job Board Slugs</div>
              <div className="card-subtitle">
                Which company boards to scrape per ATS. Find the slug in the board URL — e.g. <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>stripe</code> from <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>greenhouse.io/stripe</code>.
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gap: 16 }}>
                <BoardField label="Greenhouse boards" name="greenhouseBoards" defaultValue={listValue(prefs.greenhouseBoards)} example="stripe, figma, notion, anthropic" color="#22c55e" />
                <BoardField label="Ashby boards"      name="ashbyBoards"      defaultValue={listValue(prefs.ashbyBoards)}      example="vercel, retool, linear, perplexity" color="#6366f1" />
                <BoardField label="Lever boards"      name="leverBoards"      defaultValue={listValue(prefs.leverBoards)}      example="box, coinbase" color="#f97316" />
                <BoardField label="Workable boards"   name="workableBoards"   defaultValue={listValue(prefs.workableBoards)}   example="typeform, hotjar" color="#0ea5e9" />
              </div>
              <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
                <button type="submit" className="btn btn-primary">Save board config</button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ── Extension ────────────────────────────────────── */}
      {tab === "extension" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">Browser Extension</div>
              <div className="card-subtitle">Autofill job applications in your browser tab — including live resume tailoring and auto-submit.</div>
            </div>
            <div className="card-body">
              <div className="notice notice-info" style={{ marginBottom: 16 }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path strokeLinecap="round" d="M8 7v4M8 5.5v.5" /></svg>
                <div>
                  <p className="notice-title">How extension autofill works</p>
                  <p className="notice-body">
                    1. Open a job application page. 2. Click the JobHunter extension icon. 3. It fetches your prepared packet, tailors your resume live to the job, fills all detected fields, and optionally submits.
                  </p>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div className="inset-panel">
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Setup</div>
                  <ol style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
                    <li>Load <code style={{ fontFamily: "var(--font-mono)" }}>apps/extension/chrome</code> as an unpacked extension in Chrome</li>
                    <li>Click the extension icon and enter your API URL + token below</li>
                    <li>Click &ldquo;Test connection&rdquo; to verify</li>
                    <li>Navigate to a job&apos;s application page and hit &ldquo;Autofill tab&rdquo;</li>
                  </ol>
                </div>
                <div className="inset-panel">
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Features</div>
                  <ul style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
                    <li>Shadow DOM + iframe support</li>
                    <li>Live resume tailoring before fill</li>
                    <li>Auto-submit with confirmation</li>
                    <li>Required field detection + fallback answers</li>
                    <li>Resume file upload to file inputs</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <ExtensionTokenManager tokens={extensionTokens} />
        </div>
      )}
    </AppShell>
  );
}

/* ── Field helpers ──────────────────────────────────────── */

function SettingsField({
  label, name, defaultValue, type = "text", placeholder, hint, required,
}: {
  label: string; name: string; defaultValue?: string | null; type?: string;
  placeholder?: string; hint?: string; required?: boolean;
}) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        autoComplete={type === "password" ? "off" : undefined}
      />
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

function SettingsSelect({
  label, name, defaultValue, children, hint,
}: {
  label: string; name: string; defaultValue?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <select className="form-select" name={name} defaultValue={defaultValue}>
        {children}
      </select>
      {hint ? <span className="form-hint">{hint}</span> : null}
    </div>
  );
}

function BoardField({
  label, name, defaultValue, example, color,
}: {
  label: string; name: string; defaultValue: string; example: string; color: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
      </div>
      <div className="form-field" style={{ gap: 4 }}>
        <input
          className="form-input"
          name={name}
          defaultValue={defaultValue}
          placeholder={`e.g. ${example}`}
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        />
        <span className="form-hint">Comma-separated slugs. Leave blank to use env-var defaults.</span>
      </div>
    </div>
  );
}
