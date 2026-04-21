import { structuredProfileFields } from "@jobhunter/core";

import { AppShell } from "@/components/app-shell";

function prettify(field: string): string {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

export default function ProfilePage() {
  return (
    <AppShell
      title="Profile"
      description="Structured profile data powers repeatable form fill, rule enforcement, and trustworthy automation without asking the LLM to guess facts."
    >
      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Structured Fields</p>
            <h2>Reusable application facts</h2>
          </div>
        </div>
        <div className="field-cloud">
          {structuredProfileFields.map((field) => (
            <span key={field} className="field-chip">
              {prettify(field)}
            </span>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
