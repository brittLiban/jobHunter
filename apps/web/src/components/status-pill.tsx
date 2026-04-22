import type { ApplicationStatus } from "@jobhunter/core";

const labels: Record<ApplicationStatus, string> = {
  discovered: "Discovered",
  scored: "Scored",
  skipped: "Skipped",
  queued: "Queued Next",
  prepared: "Ready to Run",
  auto_submitted: "Auto-submitted",
  needs_user_action: "Needs Attention",
  submitted: "Submitted",
  responded: "Responded",
  interview: "Interview",
  rejected: "Rejected",
  offer: "Offer",
};

export function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`status-pill status-${status}`}>
      {labels[status]}
    </span>
  );
}
