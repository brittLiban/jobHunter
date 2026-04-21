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
        <p className="eyebrow">Get Started</p>
        <h1>Create your account</h1>
        <p>
          Onboarding will collect your structured profile, resume uploads, job preferences, and fit threshold before the worker starts preparing applications.
        </p>
        {params.error ? <p className="form-error">Sign-up failed. Try a different email or a stronger password.</p> : null}
        <form action="/api/auth/signup" method="post" className="stack-form">
          <label className="form-field">
            <span>Full name</span>
            <input type="text" name="fullName" required />
          </label>
          <label className="form-field">
            <span>Email</span>
            <input type="email" name="email" required />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input type="password" name="password" minLength={8} required />
          </label>
          <button type="submit" className="button button-primary button-full">
            Create account
          </button>
        </form>
        <div className="auth-actions">
          <Link href="/login" className="button button-secondary">
            Log in instead
          </Link>
        </div>
      </div>
    </div>
  );
}
