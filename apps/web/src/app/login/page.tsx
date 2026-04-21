import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Auth Placeholder</p>
        <h1>Log in</h1>
        <p>
          The app shell is scaffolded and ready for credential or OAuth auth wiring in the next checkpoint.
        </p>
        <div className="auth-actions">
          <Link href="/dashboard" className="button button-primary">
            Enter Demo App
          </Link>
          <Link href="/signup" className="button button-secondary">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
}
