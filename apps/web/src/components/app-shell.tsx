import Link from "next/link";
import { ReactNode } from "react";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/jobs", label: "Jobs Found" },
  { href: "/applications", label: "Applications" },
  { href: "/profile", label: "Profile" },
] as const;

export function AppShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Link href="/" className="brand-link">
          jobhunter
        </Link>
        <p className="sidebar-tagline">
          Finder + Brain + Applier + Tracker
        </p>
        <nav className="app-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="nav-link">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-card">
          <p className="eyebrow">Autonomy rule</p>
          <p>
            Auto-submit only when the flow is simple and confidence is high.
          </p>
        </div>
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
