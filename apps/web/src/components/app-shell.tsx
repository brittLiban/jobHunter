import { ReactNode } from "react";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/jobs", label: "Discovery" },
  { href: "/applications", label: "Review Queue" },
  { href: "/resumes", label: "Resumes" },
  { href: "/profile", label: "Settings" },
] as const;

export function AppShell({
  title,
  description,
  userName,
  currentPath,
  children,
}: {
  title: string;
  description: string;
  userName: string;
  currentPath: string;
  children: ReactNode;
}) {
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <a href="/" className="brand-link">
          jobhunter
        </a>
        <p className="sidebar-tagline">Finder + Brain + Applier + Tracker</p>
        <div className="sidebar-user">
          <p className="eyebrow">Signed In</p>
          <p>{userName}</p>
        </div>
        <nav className="app-nav">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`nav-link ${isActiveLink(currentPath, link.href) ? "nav-link-active" : ""}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-card">
          <p className="eyebrow">Autofill Modes</p>
          <div className="sidebar-steps">
            <div className="sidebar-step">
              <strong>Browser demo</strong>
              <span>Local mock apply pages open and visibly fill in your browser.</span>
            </div>
            <div className="sidebar-step">
              <strong>Live Greenhouse</strong>
              <span>Playwright runs the live form, then reopens the page it reached or records a confirmed submit.</span>
            </div>
          </div>
        </div>
        <form action="/api/auth/logout" method="post" className="sidebar-logout">
          <button type="submit" className="button button-secondary button-full">
            Log out
          </button>
        </form>
      </aside>
      <main className="app-main">
        <header className="app-header">
          <div>
            <p className="eyebrow">Authenticated App</p>
            <h1>{title}</h1>
            <p className="app-description">{description}</p>
          </div>
          <div className="app-header-panel">
            <p className="eyebrow">Queue language</p>
            <p>Ready to run means the packet is prepared. Needs attention means the site paused on a real blocker. Submitted only appears after a confirmed finish.</p>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function isActiveLink(currentPath: string, href: string) {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
