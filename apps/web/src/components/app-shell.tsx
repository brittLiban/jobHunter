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
  children,
}: {
  title: string;
  description: string;
  userName: string;
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
            <a key={link.href} href={link.href} className="nav-link">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-card">
          <p className="eyebrow">Autonomy rule</p>
          <p>
            Auto-submit only when the flow is simple and confidence is high.
          </p>
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
          </div>
          <p className="app-description">{description}</p>
        </header>
        {children}
      </main>
    </div>
  );
}
