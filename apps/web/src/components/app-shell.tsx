import { ReactNode } from "react";

const NAV_LINKS = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1" y="1" width="6" height="6" rx="1.5" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/jobs",
    label: "Discovery",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="4.5" />
        <path strokeLinecap="round" d="M10.5 10.5L14 14" />
      </svg>
    ),
  },
  {
    href: "/applications",
    label: "Review Queue",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 4h12M2 8h8M2 12h6" />
      </svg>
    ),
  },
  {
    href: "/resumes",
    label: "Resumes",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 1.5h8a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z" />
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
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
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
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
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
  description: string;
  userName: string;
  currentPath: string;
  children: ReactNode;
  llmProvider?: string | null;
  scraperRunning?: boolean;
  attentionCount?: number;
}) {
  const resolvedProvider = llmProvider ?? detectEnvLlmProvider();
  const hasLlm = resolvedProvider !== null;
  const initials = getInitials(userName);

  return (
    <div className="app-layout">
      {/* ── Dark Sidebar ──────────────────────────────────── */}
      <aside className="app-sidebar">
        {/* Logo */}
        <div className="sb-logo">
          <div className="sb-logo-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8a5 5 0 1110 0A5 5 0 013 8z" fill="white" opacity=".3" />
              <path d="M8 4v4l3 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="8" r="2" fill="white" />
            </svg>
          </div>
          <span className="sb-logo-name">JobHunter</span>
        </div>
        <p className="sb-tagline">Find · Score · Apply · Track</p>

        <div className="sb-divider" />

        {/* Main Nav */}
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

        {/* Worker / Scraper status */}
        <div className="sb-section">
          <p className="sb-section-label">Automation</p>
          <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="sb-status-card">
              <div className="sb-status-card-title">
                <span
                  className={`sb-status-dot ${scraperRunning ? "running" : "idle"}`}
                />
                Scraper
              </div>
              <div className="sb-status-card-body">
                {scraperRunning ? (
                  <><strong>Running…</strong> collecting jobs</>
                ) : (
                  "Idle — use dashboard to run"
                )}
              </div>
            </div>

            <div className="sb-status-card">
              <div className="sb-status-card-title">
                <span className={`sb-status-dot ${hasLlm ? "active" : "idle"}`} />
                AI Engine
              </div>
              <div className="sb-status-card-body">
                {hasLlm ? (
                  <><strong>{resolvedProvider}</strong> · active</>
                ) : (
                  <>Not configured · <a href="/profile" style={{ color: "var(--sb-active-fg)" }}>set up</a></>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: user + logout */}
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
              Log out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main Canvas ───────────────────────────────────── */}
      <main className="app-main">
        <div className="app-page">
          <div className="page-header">
            <div className="page-header-left">
              <p className="page-eyebrow">JobHunter</p>
              <h1 className="page-title">{title}</h1>
              {description ? <p className="page-subtitle">{description}</p> : null}
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
