import { AppShell } from "@/components/app-shell";
import { requireOnboardedUser } from "@/lib/auth";
import { loadResumesPageData } from "@/lib/page-data";

export default async function ResumesPage() {
  const user = await requireOnboardedUser();
  const resumes = await loadResumesPageData(user.id);
  const defaultResume = resumes.find((r) => r.isDefault);

  return (
    <AppShell
      title="Resumes"
      description="Upload base resumes. The worker automatically generates tailored versions per application."
      userName={user.fullName ?? user.email}
      currentPath="/resumes"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Upload */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Upload Resume</div>
              <div className="card-subtitle">Add a new base resume for scoring and tailoring</div>
            </div>
          </div>
          <div className="card-body">
            <form action="/api/resumes" method="post" encType="multipart/form-data" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="form-field">
                <label className="form-label">Label</label>
                <input className="form-input" name="label" placeholder="e.g. Software Engineer — Base" required />
                <span className="form-hint">A memorable name for this resume version.</span>
              </div>

              <div className="form-field">
                <label className="form-label">Resume file (PDF or DOCX)</label>
                <input
                  className="form-input"
                  type="file"
                  name="resumeFile"
                  accept=".pdf,.doc,.docx"
                  required
                  style={{ cursor: "pointer" }}
                />
              </div>

              <div className="form-field">
                <label className="form-label">Plain-text content</label>
                <textarea
                  className="form-textarea"
                  name="baseText"
                  rows={10}
                  placeholder="Paste the plain text of your resume here. This is what the AI reads to score and tailor your applications."
                  required
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
                <span className="form-hint">Used by the AI for scoring and tailoring — copy/paste from your resume document.</span>
              </div>

              <label className="checkbox-field">
                <input type="checkbox" name="setAsDefault" />
                <span className="form-label" style={{ margin: 0 }}>Set as default resume</span>
              </label>

              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v8M5 7l3 3 3-3M3 13h10" />
                </svg>
                Upload resume
              </button>
            </form>
          </div>
        </div>

        {/* Library */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {resumes.length === 0 ? (
            <div className="card">
              <div className="empty-state" style={{ padding: "40px 24px" }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 1.5h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z" />
                  <path strokeLinecap="round" d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
                </svg>
                <p className="empty-state-title">No resumes yet</p>
                <p className="empty-state-body">Upload a base resume to unlock AI scoring, tailoring, and autofill.</p>
              </div>
            </div>
          ) : null}

          {resumes.map((resume) => (
            <div key={resume.id} className="card">
              <div className="card-body-sm">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="resume-card-icon">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 1.5h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z" />
                      <path strokeLinecap="round" d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="resume-card-name">{resume.label}</div>
                    <div className="resume-card-meta">{resume.originalFileName}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    {resume.isDefault ? (
                      <span className="badge badge-prepared">Default</span>
                    ) : null}
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {resume.versions.length} tailored version{resume.versions.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                {/* Tailored versions */}
                {resume.versions.length > 0 ? (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--border-2)", paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Tailored Versions
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {resume.versions.map((v) => (
                        <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
                          <span style={{ color: "var(--text)" }}>{v.label || "Tailored version"}</span>
                          <span style={{ color: "var(--text-3)" }}>{formatDate(v.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-2)" }}>
                    Tailored versions will appear here after the worker prepares applications using this resume.
                  </p>
                )}
              </div>
            </div>
          ))}

          {/* Info callout */}
          <div className="notice notice-info">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
              <path strokeLinecap="round" d="M8 7v4M8 5.5v.5" />
            </svg>
            <div>
              <p className="notice-title">How tailoring works</p>
              <p className="notice-body">
                For each application, the AI rewrites your summary line and 2–4 bullets to match the job description. The original resume is never modified.
                {defaultResume ? ` Currently using "${defaultResume.label}" as default.` : ""}
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
