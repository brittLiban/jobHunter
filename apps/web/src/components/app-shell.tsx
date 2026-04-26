import { ReactNode } from "react";

const NAV_LINKS = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/scraper",
    label: "Scraper",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h2M8 3v2M13 8h-2M8 13v-2" />
        <circle cx="8" cy="8" r="2.5" />
        <path strokeLinecap="round" d="M5.5 5.5L4 4M10.5 5.5L12 4M10.5 10.5L12 12M5.5 10.5L4 12" />
      </svg>
    ),
  },
  {
    href: "/jobs",
    label: "Discovery",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="6.5" cy="6.5" r="4" />
        <path strokeLinecap="round" d="M10 10L14 14" />
      </svg>
    ),
  },
  {
    href: "/applications",
    label: "Review Queue",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 4.5h12M2 8.5h8M2 12.5h5" />
      </svg>
    ),
  },
  {
    href: "/resumes",
    label: "Resumes",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
        <path strokeLinecap="round" d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M11.9 4.1l-.7.7M4.1 11.9l-.7.7" />
      </svg>
    ),
  },
] as const;

function detectEnvLlmProvider(): string | null {
  if (process.env.OLLAMA_URL) return "Ollama";
  if (process.env.OPENAI_API_KEY) return "OpenAI";
  if (process.env.ANTHROPIC_API_KEY) return "Anthropic";
  return null;
}

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function AppShell({
  title,
  description,
  userName,
  currentPath,
  children,
  llmProvider,
  scraperRunning,
  attentionCount,
}: {
  title: string;
  description?: string;
  userName: string;
  currentPath: string;
  children: ReactNode;
  llmProvider?: string | null;
  scraperRunning?: boolean;
  attentionCount?: number;
}) {
  const resolvedProvider = llmProvider ?? detectEnvLlmProvider();
  const initials = getInitials(userName);

  return (
    <div className="app-layout">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div className="sb-logo">
          <div className="sb-logo-icon">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 2a6 6 0 100 12A6 6 0 008 2z" fill="white" opacity=".25" />
              <path d="M8 5v3l2.5 1.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="1.5" fill="white" />
            </svg>
          </div>
          <span className="sb-logo-name">JobHunter</span>
        </div>
        <p className="sb-tagline">Automated Applications</p>

        <div className="sb-divider" />

        {/* Navigation */}
        <div className="sb-section">
          <nav className="sb-nav">
            {NAV_LINKS.map((link) => {
              const isActive = currentPath === link.href || currentPath.startsWith(`${link.href}/`);
              const showBadge = link.href === "/applications" && (attentionCount ?? 0) > 0;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className={`sb-nav-link${isActive ? " active" : ""}`}
                >
                  {link.icon}
                  {link.label}
                  {showBadge ? (
                    <span className="sb-badge">{attentionCount}</span>
                  ) : null}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="sb-divider" />

        {/* System status — compact rows */}
        <div className="sb-section">
          <p className="sb-section-label">System</p>
          <div className="sb-system">
            <div className="sb-system-row">
              <span className="sb-system-row-label">Scraper</span>
              <span className="sb-pill">
                <span className={`sb-dot ${scraperRunning ? "running" : "idle"}`} />
                <span className="sb-system-row-val">{scraperRunning ? "Running" : "Idle"}</span>
              </span>
            </div>
            <div className="sb-system-row">
              <span className="sb-system-row-label">AI Engine</span>
              <span className="sb-pill">
                <span className={`sb-dot ${resolvedProvider ? "active" : "idle"}`} />
                <span className="sb-system-row-val">{resolvedProvider ?? "None"}</span>
              </span>
            </div>
          </div>
        </div>

        {/* User + logout */}
        <div className="sb-bottom">
          <div className="sb-user">
            <div className="sb-avatar">{initials || "U"}</div>
            <span className="sb-user-name">{userName}</span>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="sb-logout-btn">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10.5 11L14 8l-3.5-3M14 8H6" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <main className="app-main">
        <div className="app-page">
          <div className="page-header">
            <p className="page-eyebrow">JobHunter</p>
            <h1 className="page-title">{title}</h1>
            {description ? <p className="page-subtitle">{description}</p> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
