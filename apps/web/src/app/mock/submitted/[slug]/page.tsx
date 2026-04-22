import Link from "next/link";

export default async function MockSubmittedPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Mock Confirmation</p>
        <h1>Application submitted</h1>
        <p className="hero-text">
          This local confirmation page exists so Playwright can verify a successful submit without touching a real employer site.
        </p>
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
