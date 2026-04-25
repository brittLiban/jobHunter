import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const demoSeedEnabled = process.env.JOBHUNTER_ENABLE_DEMO_SEED === "true";

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

        <p className="eyebrow">Sign In</p>
        <h1>Welcome back</h1>
        <p>Enter your credentials to access your application pipeline.</p>

        {demoSeedEnabled ? (
          <div className="auth-note">
            <p className="eyebrow">Demo Account</p>
            <p>Email: <code>demo@jobhunter.local</code></p>
            <p>Password: <code>DemoPass123!</code></p>
          </div>
        ) : null}

        {params.error ? (
          <p className="form-error" style={{ marginBottom: 16 }}>
            Login failed — check your email and password.
          </p>
        ) : null}

        <form action="/api/auth/login" method="post" className="stack-form">
          <label className="form-field">
            <span>Email</span>
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input type="password" name="password" required autoComplete="current-password" />
          </label>
          <button type="submit" className="button button-primary button-full" style={{ marginTop: 4 }}>
            Sign in
          </button>
        </form>

        <div className="auth-actions">
          <Link href="/signup" className="button button-secondary">
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
