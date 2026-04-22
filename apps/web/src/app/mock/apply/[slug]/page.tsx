const companyBySlug: Record<string, string> = {
  "vercel-integrations": "Vercel",
  "figma-backend": "Figma",
  "stripe-new-grad": "Stripe",
};

export default async function MockApplyPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const company = companyBySlug[slug] ?? "JobHunter Demo Company";

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card">
        <p className="eyebrow">Mock Apply Flow</p>
        <h1>Apply to {company}</h1>
        <p className="hero-text">
          This is a safe local form used to verify autofill and submit behavior inside the Docker stack.
        </p>
        <form action={`/mock/submitted/${slug}`} method="get" className="stack-form">
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
            <span>LinkedIn Profile *</span>
            <input id="linkedin" name="linkedin" type="url" required />
          </label>
          <label className="form-field">
            <span>Portfolio or Personal Website *</span>
            <input id="portfolio" name="portfolio" type="url" required />
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
            <span>Resume *</span>
            <input id="resume" name="resume" type="file" required />
          </label>
          <button type="submit" className="button button-primary">
            Submit application
          </button>
        </form>
      </section>
    </main>
  );
}
