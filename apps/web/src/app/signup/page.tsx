import Link from "next/link";

export default function SignupPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Get Started</p>
        <h1>Create your account</h1>
        <p>
          Onboarding will collect your structured profile, resume uploads, job preferences, and fit threshold before the worker starts preparing applications.
        </p>
        <div className="auth-actions">
          <Link href="/dashboard" className="button button-primary">
            Preview Dashboard
          </Link>
          <Link href="/" className="button button-secondary">
            Back to site
          </Link>
        </div>
      </div>
    </div>
  );
}
