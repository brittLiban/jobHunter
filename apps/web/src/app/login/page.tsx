import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Credential Sign-In</p>
        <h1>Log in</h1>
        <p>
          Sign in with your email and password to access onboarding, resumes, the dashboard, and application review flows.
        </p>
        {params.error ? <p className="form-error">Login failed. Check your email and password.</p> : null}
        <form action="/api/auth/login" method="post" className="stack-form">
          <label className="form-field">
            <span>Email</span>
            <input type="email" name="email" required />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input type="password" name="password" required />
          </label>
          <button type="submit" className="button button-primary button-full">
            Log in
          </button>
        </form>
        <div className="auth-actions">
          <Link href="/signup" className="button button-secondary">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
}
