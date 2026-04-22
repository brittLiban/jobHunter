import { requireCurrentUser } from "@/lib/auth";
import { getProfileBundle } from "@jobhunter/db";
import { redirect } from "next/navigation";

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

function listValue(value: string[] | undefined, fallback: string) {
  return value && value.length > 0 ? value.join(", ") : fallback;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireCurrentUser();
  if (user.onboardingCompletedAt) {
    redirect("/dashboard");
  }
  const bundle = await getProfileBundle(user.id);
  const params = await searchParams;
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
    <div className="auth-page onboarding-page">
      <div className="auth-card onboarding-card">
        <p className="eyebrow">Structured Onboarding</p>
        <h1>Build your reusable profile and discovery controls</h1>
        <p>
          Structured facts power autofill. Discovery controls decide what the worker is even allowed to keep, so irrelevant jobs never enter the queue in the first place.
        </p>
        {params.error ? (
          <p className="form-error">The submitted profile was invalid. Review the required fields and try again.</p>
        ) : null}
        <form action="/api/profile/onboarding" method="post" className="profile-form">
          <section className="form-section">
            <h2>Identity</h2>
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
            </div>
          </section>

          <section className="form-section">
            <h2>Eligibility</h2>
            <div className="form-grid">
              <label className="form-field"><span>Work authorization</span><input name="workAuthorization" defaultValue={bundle?.profile.workAuthorization ?? "Authorized to work in the United States"} required /></label>
              <label className="form-field"><span>U.S. citizen status</span><input name="usCitizenStatus" defaultValue={bundle?.profile.usCitizenStatus ?? "U.S. Citizen"} required /></label>
              <label className="form-field"><span>Requires visa sponsorship</span><select name="requiresVisaSponsorship" defaultValue={String(bundle?.profile.requiresVisaSponsorship ?? false)}><option value="false">No</option><option value="true">Yes</option></select></label>
              <label className="form-field"><span>Veteran status</span><input name="veteranStatus" defaultValue={bundle?.profile.veteranStatus ?? "Not a protected veteran"} required /></label>
              <label className="form-field"><span>Disability status</span><input name="disabilityStatus" defaultValue={bundle?.profile.disabilityStatus ?? ""} /></label>
            </div>
          </section>

          <section className="form-section">
            <h2>Education and experience</h2>
            <div className="form-grid">
              <label className="form-field"><span>School</span><input name="school" defaultValue={bundle?.profile.school ?? ""} required /></label>
              <label className="form-field"><span>Degree</span><input name="degree" defaultValue={bundle?.profile.degree ?? ""} required /></label>
              <label className="form-field"><span>Graduation date</span><input type="date" name="graduationDate" defaultValue={bundle?.profile.graduationDate ?? ""} required /></label>
              <label className="form-field"><span>Years of experience</span><input type="number" min="0" name="yearsOfExperience" defaultValue={String(bundle?.profile.yearsOfExperience ?? 0)} required /></label>
              <label className="form-field"><span>Current company</span><input name="currentCompany" defaultValue={bundle?.profile.currentCompany ?? ""} required /></label>
              <label className="form-field"><span>Current title</span><input name="currentTitle" defaultValue={bundle?.profile.currentTitle ?? ""} required /></label>
            </div>
          </section>

          <section className="form-section">
            <h2>Discovery controls</h2>
            <div className="form-grid">
              <label className="form-field"><span>Target roles</span><input name="targetRoles" defaultValue={listValue(bundle?.preferences.targetRoles, "software engineer, backend engineer")} required /></label>
              <label className="form-field"><span>Locations</span><input name="locations" defaultValue={listValue(bundle?.preferences.locations, "Remote within U.S., Seattle, WA, Bellevue, WA")} required /></label>
              <label className="form-field"><span>Include keywords</span><input name="includeKeywords" defaultValue={listValue(bundle?.preferences.includeKeywords, "")} placeholder="python, backend, entry level" /></label>
              <label className="form-field"><span>Exclude keywords</span><input name="excludeKeywords" defaultValue={listValue(bundle?.preferences.excludeKeywords, "senior, manager, ireland")} placeholder="senior, manager, ireland" /></label>
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
          </section>

          <button type="submit" className="button button-primary button-full">
            Save onboarding
          </button>
        </form>
      </div>
    </div>
  );
}
