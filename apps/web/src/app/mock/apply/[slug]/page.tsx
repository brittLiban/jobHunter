import Link from "next/link";

import { MockAutofillClient } from "@/components/mock-autofill-client";

const companyBySlug: Record<string, string> = {
  "vercel-integrations": "Vercel",
  "figma-backend": "Figma",
  "stripe-new-grad": "Stripe",
};

export default async function MockApplyPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ applicationId?: string; autofill?: string }>;
  },
) {
  const { slug } = await params;
  const query = await searchParams;
  const company = companyBySlug[slug] ?? "JobHunter Demo Company";
  const applicationId = typeof query.applicationId === "string" ? query.applicationId : null;
  const autofillRequested = query.autofill === "1";

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card mock-apply-card">
        <p className="eyebrow">Mock Apply Flow</p>
        <h1>Apply to {company}</h1>
        <p className="hero-text">
          This local application page is where JobHunter visibly opens, fills, and submits a safe demo flow so you can verify the behavior end to end.
        </p>
        <div className="hero-actions">
          <Link href="/applications" className="button button-secondary">
            Back to applications
          </Link>
          <Link href={`/mock/jobs/${slug}`} className="button button-secondary">
            Back to job
          </Link>
        </div>
        <MockAutofillClient applicationId={applicationId} autofillRequested={autofillRequested} />
        <div className="app-card mock-helper-card">
          <p className="eyebrow">How this behaves</p>
          <h2>Browser autofill should be obvious</h2>
          <ul className="flat-list">
            <li>JobHunter opens this page directly.</li>
            <li>It fills saved profile data, short answers, and your prepared resume packet.</li>
            <li>It submits only after the form validates cleanly. If something is missing, it stops instead of guessing.</li>
          </ul>
        </div>
        <form id="mock-apply-form" action={`/mock/submitted/${slug}`} method="get" className="stack-form">
          <input type="hidden" name="applicationId" defaultValue={applicationId ?? ""} />
          <input type="hidden" name="autofillMode" defaultValue="" />
          <input type="hidden" name="resume_token" defaultValue="" />
          <input type="hidden" name="resume_name" defaultValue="" />
          <label className="form-field">
            <span>First Name *</span>
            <input id="first_name" name="first_name" required />
          </label>
          <label className="form-field">
            <span>Last Name *</span>
            <input id="last_name" name="last_name" required />
          </label>
          <label className="form-field">
            <span>Email *</span>
            <input id="email" name="email" type="email" required />
          </label>
          <label className="form-field">
            <span>Phone *</span>
            <input id="phone" name="phone" required />
          </label>
          <label className="form-field">
            <span>LinkedIn Profile</span>
            <input id="linkedin" name="linkedin" type="url" />
          </label>
          <label className="form-field">
            <span>Portfolio or Personal Website</span>
            <input id="portfolio" name="portfolio" type="url" />
          </label>
          <label className="form-field">
            <span>Why are you interested in this role? *</span>
            <textarea id="why_role" name="why_role" rows={4} required />
          </label>
          <label className="form-field">
            <span>Why are you a fit for this role? *</span>
            <textarea id="why_fit" name="why_fit" rows={4} required />
          </label>
          <label className="form-field">
            <span>Anything else we should know? *</span>
            <textarea id="anything_else" name="anything_else" rows={4} required />
          </label>
          <label className="form-field">
            <span>Resume</span>
            <input id="resume" name="resume" type="file" />
            <small className="field-help">
              In the mock autofill flow, JobHunter uses your saved resume packet and records it without relying on a manual upload.
            </small>
          </label>
          <button type="submit" className="button button-primary">
            Submit application
          </button>
        </form>
      </section>
    </main>
  );
}
