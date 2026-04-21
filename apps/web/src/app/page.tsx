import Link from "next/link";

import { demoDashboardSnapshot, structuredProfileFields } from "@jobhunter/core";

const promisePoints = [
  "Find jobs from supported sources and keep only the ones above threshold.",
  "Score each role against structured profile data, preferences, and base resumes.",
  "Tailor resume content and short answers without inventing experience.",
  "Fill and auto-submit predictable application flows with Playwright.",
] as const;

const pauseReasons = [
  "CAPTCHA or anti-bot protection",
  "Email or security code verification",
  "Upload failures",
  "Unknown field structures",
  "Missing required information",
  "Ambiguous submit states",
] as const;

export default function MarketingPage() {
  return (
    <div className="marketing-page">
      <header className="site-header">
        <Link href="/" className="brand-link">
          jobhunter
        </Link>
        <nav className="site-nav">
          <a href="#how-it-works">How It Works</a>
          <a href="#safety">Safety</a>
          <a href="#dashboard">Dashboard</a>
          <Link href="/login">Log in</Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Human-In-The-Loop Job Automation</p>
            <h1>Find, prepare, fill, and submit job applications when possible.</h1>
            <p className="hero-text">
              JobHunter scores roles against a structured profile, tailors resume
              content, writes short answers, fills forms, and only pauses when a
              real person is actually needed.
            </p>
            <p className="hero-promise">
              “We find, prepare, fill, and submit job applications for you when
              possible. When a site needs you, we pause and make it as easy as
              possible to finish.”
            </p>
            <div className="hero-actions">
              <Link href="/signup" className="button button-primary">
                Start Setup
              </Link>
              <Link href="/dashboard" className="button button-secondary">
                Preview App
              </Link>
            </div>
            <div className="hero-metrics">
              <div className="metric-card">
                <span>Jobs Found</span>
                <strong>{demoDashboardSnapshot.overview.jobsFound}</strong>
              </div>
              <div className="metric-card">
                <span>Above Threshold</span>
                <strong>{demoDashboardSnapshot.overview.aboveThreshold}</strong>
              </div>
              <div className="metric-card">
                <span>Auto Submitted</span>
                <strong>{demoDashboardSnapshot.overview.autoSubmitted}</strong>
              </div>
              <div className="metric-card">
                <span>Needs User Action</span>
                <strong>{demoDashboardSnapshot.overview.needsUserAction}</strong>
              </div>
            </div>
          </div>

          <div className="hero-panel">
            <div className="panel-surface">
              <div className="panel-topline">
                <span>Autonomous Pipeline</span>
                <span>Fit Threshold: 70+</span>
              </div>
              <div className="pipeline-grid">
                <article>
                  <p className="eyebrow">Finder</p>
                  <h3>Job discovery</h3>
                  <p>Mock adapters first, then real ATS connectors behind a stable source interface.</p>
                </article>
                <article>
                  <p className="eyebrow">Brain</p>
                  <h3>Scoring + tailoring</h3>
                  <p>Structured profile data feeds reusable scoring, resume tailoring, and short-answer services.</p>
                </article>
                <article>
                  <p className="eyebrow">Applier</p>
                  <h3>Form filling</h3>
                  <p>Playwright fills recognized fields, uploads resumes, and submits only when the state is clear.</p>
                </article>
                <article>
                  <p className="eyebrow">Tracker</p>
                  <h3>Every step logged</h3>
                  <p>Prepared payloads, answer drafts, statuses, and user checkpoints stay visible in the dashboard.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="content-section" id="how-it-works">
          <div className="section-heading">
            <p className="eyebrow">How It Works</p>
            <h2>One profile, reusable across every application</h2>
          </div>
          <div className="feature-grid">
            {promisePoints.map((item) => (
              <article className="feature-card" key={item}>
                <h3>{item.split(".")[0]}</h3>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="content-section accent-section" id="safety">
          <div className="section-heading">
            <p className="eyebrow">Why Human-In-The-Loop</p>
            <h2>Safer than blind automation, faster than manual application grind</h2>
          </div>
          <div className="comparison-grid">
            <article className="comparison-card">
              <h3>Auto-submit when safe</h3>
              <ul className="flat-list">
                <li>Recognized fields map cleanly to saved profile data.</li>
                <li>Resume uploads succeed and confirmation states are visible.</li>
                <li>The flow is simple, predictable, and high confidence.</li>
              </ul>
            </article>
            <article className="comparison-card">
              <h3>Pause when needed</h3>
              <ul className="flat-list">
                {pauseReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <p className="eyebrow">Structured Profile Auto-Fill</p>
            <h2>Profile facts stay grounded, reusable, and outside the LLM</h2>
          </div>
          <div className="field-cloud">
            {structuredProfileFields.map((field) => (
              <span key={field} className="field-chip">
                {field}
              </span>
            ))}
          </div>
        </section>

        <section className="content-section" id="dashboard">
          <div className="section-heading">
            <p className="eyebrow">Dashboard</p>
            <h2>Track discovered jobs, prepared applications, auto-submits, and user checkpoints</h2>
          </div>
          <div className="dashboard-preview">
            <div className="preview-sidebar">
              <p className="eyebrow">Queue Health</p>
              <div className="preview-stat">
                <span>Prepared</span>
                <strong>{demoDashboardSnapshot.overview.prepared}</strong>
              </div>
              <div className="preview-stat">
                <span>Queued</span>
                <strong>{demoDashboardSnapshot.overview.queued}</strong>
              </div>
              <div className="preview-stat">
                <span>Needs User Action</span>
                <strong>{demoDashboardSnapshot.overview.needsUserAction}</strong>
              </div>
            </div>
            <div className="preview-table">
              {demoDashboardSnapshot.applications.map((application) => (
                <div key={application.id} className="preview-row">
                  <div>
                    <p>{application.company}</p>
                    <span>{application.role}</span>
                  </div>
                  <div>
                    <p>{application.source}</p>
                    <span>{application.fitScore}/100</span>
                  </div>
                  <div>
                    <p>{application.status.replaceAll("_", " ")}</p>
                    <span>{new Date(application.updatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="content-section cta-section">
          <div>
            <p className="eyebrow">Start With A Safer Workflow</p>
            <h2>Automate the boring parts. Keep the human where judgment is required.</h2>
          </div>
          <div className="cta-actions">
            <Link href="/signup" className="button button-primary">
              Create Account
            </Link>
            <Link href="/dashboard" className="button button-secondary">
              View App Shell
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
