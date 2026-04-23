import { AppShell } from "@/components/app-shell";
import { ExtensionTokenManager } from "@/components/extension-token-manager";
import { requireOnboardedUser } from "@/lib/auth";
import { loadProfilePageData } from "@/lib/page-data";
import { listExtensionTokensForUser } from "@jobhunter/db";

const workModeOptions = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on_site", label: "On-site" },
  { value: "flexible", label: "Flexible" },
] as const;

const seniorityOptions = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
] as const;

const sourceOptions = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "ashby", label: "Ashby" },
  { value: "lever", label: "Lever" },
  { value: "workable", label: "Workable" },
  { value: "mock", label: "Mock" },
] as const;

function listValue(value: string[] | undefined) {
  return value && value.length > 0 ? value.join(", ") : "";
}

export default async function ProfilePage() {
  const user = await requireOnboardedUser();
  const bundle = await loadProfilePageData(user.id);
  const extensionTokens = await listExtensionTokensForUser(user.id);
  const selectedWorkModes = new Set(
    bundle?.preferences.workModes && bundle.preferences.workModes.length > 0
      ? bundle.preferences.workModes
      : ["remote", "hybrid"],
  );
  const selectedSeniority = new Set(
    bundle?.preferences.seniorityTargets && bundle.preferences.seniorityTargets.length > 0
      ? bundle.preferences.seniorityTargets
      : ["entry", "mid"],
  );
  const selectedSources = new Set(
    bundle?.preferences.sourceKinds && bundle.preferences.sourceKinds.length > 0
      ? bundle.preferences.sourceKinds
      : ["greenhouse", "ashby", "lever", "workable", "mock"],
  );

  return (
    <AppShell
      title="Settings"
      description="Tune structured profile fields and discovery controls before the worker pulls in new jobs."
      userName={user.fullName ?? user.email}
      currentPath="/profile"
    >
      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Identity And Experience</p>
            <h2>Reusable application facts</h2>
          </div>
        </div>
        <form action="/api/profile" method="post" className="profile-form">
          <div className="form-section">
            <div className="form-grid">
              <label className="form-field"><span>Full legal name</span><input name="fullLegalName" defaultValue={bundle?.profile.fullLegalName ?? user.fullName ?? ""} required /></label>
              <label className="form-field"><span>Email</span><input type="email" name="email" defaultValue={bundle?.profile.email ?? user.email} required /></label>
              <label className="form-field"><span>Phone</span><input name="phone" defaultValue={bundle?.profile.phone ?? ""} required /></label>
              <label className="form-field"><span>City</span><input name="city" defaultValue={bundle?.profile.city ?? ""} required /></label>
              <label className="form-field"><span>State</span><input name="state" defaultValue={bundle?.profile.state ?? ""} required /></label>
              <label className="form-field"><span>Country</span><input name="country" defaultValue={bundle?.profile.country ?? "United States"} required /></label>
              <label className="form-field"><span>LinkedIn URL</span><input name="linkedinUrl" defaultValue={bundle?.profile.linkedinUrl ?? ""} /></label>
              <label className="form-field"><span>GitHub URL</span><input name="githubUrl" defaultValue={bundle?.profile.githubUrl ?? ""} /></label>
              <label className="form-field"><span>Portfolio URL</span><input name="portfolioUrl" defaultValue={bundle?.profile.portfolioUrl ?? ""} /></label>
              <label className="form-field"><span>Work authorization</span><input name="workAuthorization" defaultValue={bundle?.profile.workAuthorization ?? ""} required /></label>
              <label className="form-field"><span>U.S. citizen status</span><input name="usCitizenStatus" defaultValue={bundle?.profile.usCitizenStatus ?? ""} required /></label>
              <label className="form-field"><span>Requires visa sponsorship</span><select name="requiresVisaSponsorship" defaultValue={String(bundle?.profile.requiresVisaSponsorship ?? false)}><option value="false">No</option><option value="true">Yes</option></select></label>
              <label className="form-field"><span>Veteran status</span><input name="veteranStatus" defaultValue={bundle?.profile.veteranStatus ?? ""} required /></label>
              <label className="form-field"><span>Disability status</span><input name="disabilityStatus" defaultValue={bundle?.profile.disabilityStatus ?? ""} /></label>
              <label className="form-field"><span>School</span><input name="school" defaultValue={bundle?.profile.school ?? ""} required /></label>
              <label className="form-field"><span>Degree</span><input name="degree" defaultValue={bundle?.profile.degree ?? ""} required /></label>
              <label className="form-field"><span>Graduation date</span><input type="date" name="graduationDate" defaultValue={bundle?.profile.graduationDate ?? ""} required /></label>
              <label className="form-field"><span>Years of experience</span><input type="number" min="0" name="yearsOfExperience" defaultValue={String(bundle?.profile.yearsOfExperience ?? 0)} required /></label>
              <label className="form-field"><span>Current company</span><input name="currentCompany" defaultValue={bundle?.profile.currentCompany ?? ""} required /></label>
              <label className="form-field"><span>Current title</span><input name="currentTitle" defaultValue={bundle?.profile.currentTitle ?? ""} required /></label>
            </div>
          </div>

          <div className="form-section">
            <h2>Discovery Controls</h2>
            <p className="section-copy">
              These settings decide what the worker keeps. If a job is outside the selected sources, locations, seniority range, or keyword filters, it will not be persisted into the queue.
            </p>
            <div className="form-grid">
              <label className="form-field"><span>Target roles</span><input name="targetRoles" defaultValue={listValue(bundle?.preferences.targetRoles)} required /></label>
              <label className="form-field"><span>Locations</span><input name="locations" defaultValue={listValue(bundle?.preferences.locations)} required /></label>
              <label className="form-field"><span>Include keywords</span><input name="includeKeywords" defaultValue={listValue(bundle?.preferences.includeKeywords)} placeholder="python, backend, entry level" /></label>
              <label className="form-field"><span>Exclude keywords</span><input name="excludeKeywords" defaultValue={listValue(bundle?.preferences.excludeKeywords)} placeholder="senior, manager, ireland" /></label>
              <label className="form-field"><span>Salary floor</span><input type="number" min="0" name="salaryFloor" defaultValue={bundle?.preferences.salaryFloor ?? ""} /></label>
              <label className="form-field"><span>Fit threshold</span><input type="number" min="0" max="100" name="fitThreshold" defaultValue={bundle?.preferences.fitThreshold ?? 70} required /></label>
              <label className="form-field"><span>Daily target volume</span><input type="number" min="1" max="100" name="dailyTargetVolume" defaultValue={bundle?.preferences.dailyTargetVolume ?? 15} required /></label>
            </div>

            <div className="choice-section">
              <div>
                <p className="eyebrow">Work Modes</p>
                <div className="choice-grid">
                  {workModeOptions.map((option) => (
                    <label key={option.value} className="choice-chip">
                      <input
                        type="checkbox"
                        name="workModes"
                        value={option.value}
                        defaultChecked={selectedWorkModes.has(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="eyebrow">Seniority Targets</p>
                <div className="choice-grid">
                  {seniorityOptions.map((option) => (
                    <label key={option.value} className="choice-chip">
                      <input
                        type="checkbox"
                        name="seniorityTargets"
                        value={option.value}
                        defaultChecked={selectedSeniority.has(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="eyebrow">Enabled Sources</p>
                <div className="choice-grid">
                  {sourceOptions.map((option) => (
                    <label key={option.value} className="choice-chip">
                      <input
                        type="checkbox"
                        name="sourceKinds"
                        value={option.value}
                        defaultChecked={selectedSources.has(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button type="submit" className="button button-primary">
            Save settings
          </button>
        </form>
      </section>

      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Extension Autofill</p>
            <h2>In-browser live fill mode</h2>
          </div>
        </div>
        <p className="section-copy">
          Use the browser extension when you want the form filled in your own tab, then submit manually yourself.
          This avoids worker-session mismatch on third-party sites.
        </p>
        <div className="stack-list">
          <div className="stack-item">
            <p>Install location</p>
            <span>
              Extension source files live at <code>apps/extension/chrome</code>.
              Load it in Edge via <code>edge://extensions</code> (Developer mode), or Chrome via <code>chrome://extensions</code>.
            </span>
          </div>
          <div className="stack-item">
            <p>Usage</p>
            <span>1. Create a token below and paste it into the extension popup once.</span>
            <span>2. From Review Queue, click Open for extension autofill.</span>
            <span>3. The extension fills fields in your browser tab and you submit manually.</span>
          </div>
        </div>

        <ExtensionTokenManager
          initialTokens={extensionTokens.map((token) => ({
            id: token.id,
            label: token.label,
            tokenPrefix: token.tokenPrefix,
            createdAt: token.createdAt.toISOString(),
            lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
            expiresAt: token.expiresAt?.toISOString() ?? null,
          }))}
        />
      </section>
    </AppShell>
  );
}
