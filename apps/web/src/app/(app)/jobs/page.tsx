import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { requireOnboardedUser } from "@/lib/auth";
import { loadJobsPageData } from "@/lib/page-data";

export default async function JobsPage() {
  const user = await requireOnboardedUser();
  const jobs = await loadJobsPageData(user.id);

  return (
    <AppShell
      title="Jobs Found"
      description="Review discovered roles, fit scores, source coverage, and which jobs have moved into the application queue."
      userName={user.fullName ?? user.email}
    >
      <section className="app-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Source Coverage</p>
            <h2>Jobs above threshold</h2>
          </div>
        </div>
        <div className="list-table">
          {jobs.length === 0 ? <div className="list-row"><div><p>No jobs yet</p><span>Run the worker after onboarding and uploading a resume.</span></div></div> : null}
          {jobs.map((job) => (
            <div key={job.id} className="list-row">
              <div>
                <p>{job.title}</p>
                <span>{job.company}</span>
              </div>
              <div>
                <p>{job.sourceName}</p>
                <span>{job.fitScore !== null ? `Fit ${job.fitScore}/100` : "Unscored"}</span>
              </div>
              <div className="row-status">
                <StatusPill status={(job.status as Parameters<typeof StatusPill>[0]["status"]) ?? "discovered"} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
