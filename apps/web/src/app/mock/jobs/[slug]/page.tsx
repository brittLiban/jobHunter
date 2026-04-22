import Link from "next/link";

const mockJobs: Record<string, { title: string; company: string; description: string }> = {
  "vercel-integrations": {
    title: "Software Engineer, Integrations",
    company: "Vercel",
    description: "Build APIs, automation hooks, and partner-facing workflows for developer tooling.",
  },
  "figma-backend": {
    title: "Backend Engineer",
    company: "Figma",
    description: "Own backend services, reliability work, and collaboration-focused product APIs.",
  },
  "stripe-new-grad": {
    title: "Software Engineer, New Grad",
    company: "Stripe",
    description: "Ship software, automation, and internal platform improvements with strong engineering fundamentals.",
  },
};

export default async function MockJobPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const job = mockJobs[slug] ?? {
    title: "Mock Role",
    company: "JobHunter Demo Company",
    description: "This is a safe local mock job posting used for end-to-end autofill testing.",
  };

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card">
        <p className="eyebrow">Mock Job Posting</p>
        <h1>{job.title}</h1>
        <p className="hero-text">{job.company}</p>
        <p className="hero-text">{job.description}</p>
        <div className="hero-actions">
          <Link href={`/mock/apply/${slug}`} className="button button-primary">
            Open apply page
          </Link>
          <Link href="/jobs" className="button button-secondary">
            Back to app
          </Link>
        </div>
      </section>
    </main>
  );
}
