import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { markWorkerRunning, setWorkerResult } from "@/lib/worker-state";

export async function POST(request: Request) {
  const user = await requireOnboardedUser();

  // Don't run if already in progress
  const { getWorkerStatus } = await import("@/lib/worker-state");
  if (getWorkerStatus().running) {
    const base = request.headers.get("origin") ?? "http://localhost:3000";
    return NextResponse.redirect(`${base}/dashboard`);
  }

  markWorkerRunning();

  // Fire pipeline in background — respond immediately so the browser doesn't hang
  void (async () => {
    try {
      const { runPipeline } = await import("../../../../../../worker/src/pipeline");
      const result = await runPipeline({ onlyUserId: user.id });
      setWorkerResult({
        discoveredJobs:              result.discoveredJobs ?? 0,
        scoredApplications:          result.scoredApplications ?? 0,
        preparedApplications:        result.preparedApplications ?? 0,
        autoSubmittedApplications:   result.autoSubmittedApplications ?? 0,
        needsUserActionApplications: result.needsUserActionApplications ?? 0,
      });
    } catch (err) {
      setWorkerResult(null);
      console.error("[worker/run] pipeline error:", err);
    }
  })();

  const base = request.headers.get("origin") ?? "http://localhost:3000";
  return NextResponse.redirect(`${base}/dashboard`);
}
