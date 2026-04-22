import Link from "next/link";
import { finalizeMockApplicationSubmissionForUser } from "@jobhunter/db";

import { getOptionalCurrentUser } from "@/lib/auth";

export default async function MockSubmittedPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await getOptionalCurrentUser();
  const applicationId = readQueryValue(query.applicationId);
  const autofillMode = readQueryValue(query.autofillMode);
  const currentUrl = buildSubmittedUrl(slug, query);

  if (user && applicationId) {
    await finalizeMockApplicationSubmissionForUser({
      userId: user.id,
      applicationId,
      currentUrl,
      submissionMode: autofillMode === "browser_autofill" ? "browser_autofill" : "manual",
    });
  }

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card">
        <p className="eyebrow">Mock Confirmation</p>
        <h1>Application submitted</h1>
        <p className="hero-text">
          This local confirmation page verifies the submit path without touching a real employer site. The tracker has been updated so the application now shows as completed.
        </p>
        <div className="submitted-summary-grid">
          <div className="app-card">
            <p className="eyebrow">Submission mode</p>
            <h2>{autofillMode === "browser_autofill" ? "Browser autofill" : "Manual finish"}</h2>
            <p className="hero-text">
              {autofillMode === "browser_autofill"
                ? "JobHunter opened the page, filled the packet, and submitted it in-browser."
                : "The form was completed on the page and then confirmed here."}
            </p>
          </div>
          <div className="app-card">
            <p className="eyebrow">Saved packet used</p>
            <h2>{readQueryValue(query.resume_name) ?? "No saved resume label recorded"}</h2>
            <p className="hero-text">
              {readQueryValue(query.first_name) ?? "Candidate"} {readQueryValue(query.last_name) ?? ""}
              {readQueryValue(query.email) ? ` · ${readQueryValue(query.email)}` : ""}
            </p>
          </div>
        </div>
        <div className="app-card submitted-fields-card">
          <p className="eyebrow">Submitted snapshot</p>
          <h2>What this mock application received</h2>
          <div className="submitted-fields-grid">
            <div className="stack-item">
              <p>Why this role</p>
              <span>{readQueryValue(query.why_role) ?? "Not provided"}</span>
            </div>
            <div className="stack-item">
              <p>Why you fit</p>
              <span>{readQueryValue(query.why_fit) ?? "Not provided"}</span>
            </div>
            <div className="stack-item">
              <p>Anything else</p>
              <span>{readQueryValue(query.anything_else) ?? "Not provided"}</span>
            </div>
            <div className="stack-item">
              <p>Links</p>
              <span>{readQueryValue(query.linkedin) ?? "No LinkedIn provided"}</span>
              <span>{readQueryValue(query.portfolio) ?? "No portfolio provided"}</span>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Link href={`/mock/jobs/${slug}`} className="button button-secondary">
            Back to job
          </Link>
          <Link href="/applications" className="button button-primary">
            Return to applications
          </Link>
        </div>
      </section>
    </main>
  );
}

function readQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function buildSubmittedUrl(
  slug: string,
  params: Record<string, string | string[] | undefined>,
) {
  const search = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params)) {
    const value = readQueryValue(rawValue);
    if (value) {
      search.set(key, value);
    }
  }

  const query = search.toString();
  return query ? `/mock/submitted/${slug}?${query}` : `/mock/submitted/${slug}`;
}
