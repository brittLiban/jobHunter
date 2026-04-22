import { ReactNode } from "react";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/jobs", label: "Jobs Found" },
  { href: "/applications", label: "Applications" },
  { href: "/resumes", label: "Resumes" },
  { href: "/profile", label: "Profile" },
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
        <p className="sidebar-tagline">
          Finder + Brain + Applier + Tracker
        </p>
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
          <p className="eyebrow">Open and Autofill</p>
          <p>
            JobHunter opens supported application pages, fills the saved packet, and submits only when the flow is simple and confidence is high.
          </p>
        </div>
        <div className="sidebar-steps">
          <div className="sidebar-step">
            <strong>Ready to open</strong>
            <span>The packet is prepared, but the employer page is not complete yet.</span>
          </div>
          <div className="sidebar-step">
            <strong>Needs you</strong>
            <span>The site hit friction such as a CAPTCHA, verification step, or missing required info.</span>
          </div>
          <div className="sidebar-step">
            <strong>Submitted</strong>
            <span>The application was confirmed complete in automation or after your manual finish.</span>
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
            <p className="eyebrow">Tracker rules</p>
            <p>
              Submitted means confirmed. Needs you means the site paused on a real blocker. Open and autofill is the action that actually opens the application flow and starts the saved packet.
            </p>
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
