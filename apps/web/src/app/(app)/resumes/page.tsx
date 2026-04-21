import { AppShell } from "@/components/app-shell";
import { requireOnboardedUser } from "@/lib/auth";
import { loadResumesPageData } from "@/lib/page-data";

export default async function ResumesPage() {
  const user = await requireOnboardedUser();
  const resumes = await loadResumesPageData(user.id);

  return (
    <AppShell
      title="Resumes"
      description="Upload base resumes, mark a default version, and track tailored resume versions generated for specific applications."
      userName={user.fullName ?? user.email}
    >
      <section className="app-two-column">
        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Upload</p>
              <h2>Add a base resume</h2>
            </div>
          </div>
          <form action="/api/resumes" method="post" encType="multipart/form-data" className="stack-form">
            <label className="form-field"><span>Resume label</span><input name="label" placeholder="Software Engineer Base Resume" required /></label>
            <label className="form-field"><span>Resume file</span><input type="file" name="resumeFile" required /></label>
            <label className="form-field"><span>Base resume text</span><textarea name="baseText" rows={12} placeholder="Paste the plain-text version used for scoring and tailoring." required /></label>
            <label className="checkbox-field"><input type="checkbox" name="setAsDefault" />Set as default resume</label>
            <button type="submit" className="button button-primary button-full">
              Upload resume
            </button>
          </form>
        </article>

        <article className="app-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Library</p>
              <h2>Stored resumes</h2>
            </div>
          </div>
          <div className="stack-list">
            {resumes.length === 0 ? <div className="stack-item"><p>No resumes yet</p><span>Upload a base resume to unlock scoring, tailoring, and autofill.</span></div> : null}
            {resumes.map((resume) => (
              <div key={resume.id} className="stack-item">
                <p>{resume.label}{resume.isDefault ? " · Default" : ""}</p>
                <span>{resume.originalFileName}</span>
                <span>{resume.versions.length} tailored version(s)</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </AppShell>
  );
}
