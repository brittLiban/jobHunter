import { AppShell } from "@/components/app-shell";
import { requireOnboardedUser } from "@/lib/auth";
import { loadProfilePageData } from "@/lib/page-data";

function listValue(value: string[] | undefined) {
  return value && value.length > 0 ? value.join(", ") : "";
}

export default async function ProfilePage() {
  const user = await requireOnboardedUser();
  const bundle = await loadProfilePageData(user.id);

  return (
    <AppShell
      title="Profile"
      description="Structured profile data powers repeatable form fill, rule enforcement, and trustworthy automation without asking the LLM to guess facts."
      userName={user.fullName ?? user.email}
    >
      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Structured Fields</p>
            <h2>Edit reusable application facts</h2>
          </div>
        </div>
        <form action="/api/profile" method="post" className="profile-form">
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
            <label className="form-field"><span>Target roles</span><input name="targetRoles" defaultValue={listValue(bundle?.preferences.targetRoles)} required /></label>
            <label className="form-field"><span>Locations</span><input name="locations" defaultValue={listValue(bundle?.preferences.locations)} required /></label>
            <label className="form-field"><span>Work modes</span><input name="workModes" defaultValue={listValue(bundle?.preferences.workModes)} required /></label>
            <label className="form-field"><span>Salary floor</span><input type="number" min="0" name="salaryFloor" defaultValue={bundle?.preferences.salaryFloor ?? ""} /></label>
            <label className="form-field"><span>Fit threshold</span><input type="number" min="0" max="100" name="fitThreshold" defaultValue={bundle?.preferences.fitThreshold ?? 70} required /></label>
            <label className="form-field"><span>Daily target volume</span><input type="number" min="1" max="100" name="dailyTargetVolume" defaultValue={bundle?.preferences.dailyTargetVolume ?? 15} required /></label>
          </div>
          <button type="submit" className="button button-primary">
            Save profile
          </button>
        </form>
      </section>
    </AppShell>
  );
}
