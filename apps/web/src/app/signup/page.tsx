import Link from "next/link";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 34, height: 34, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(99,102,241,0.35)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5" fill="white" opacity=".25" />
              <path d="M8 5v3l2.5 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="1.5" fill="white" />
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>JobHunter</span>
        </div>

        <p className="eyebrow">Get Started</p>
        <h1>Create your account</h1>
        <p>
          Onboarding will set up your profile, resume, job preferences, and scoring threshold before automation starts.
        </p>

        {params.error ? (
          <p className="form-error" style={{ marginBottom: 16 }}>
            Sign-up failed — try a different email or a stronger password.
          </p>
        ) : null}

        <form action="/api/auth/signup" method="post" className="stack-form">
          <label className="form-field">
            <span>Full name</span>
            <input type="text" name="fullName" required autoComplete="name" />
          </label>
          <label className="form-field">
            <span>Email</span>
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input type="password" name="password" minLength={8} required autoComplete="new-password" />
          </label>
          <button type="submit" className="button button-primary button-full" style={{ marginTop: 4 }}>
            Create account
          </button>
        </form>

        <div className="auth-actions">
          <Link href="/login" className="button button-secondary">
            Sign in instead
          </Link>
        </div>
      </div>
    </div>
  );
}
