import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { markWorkerRunning, setWorkerResult } from "@/lib/worker-state";

export async function POST(request: Request) {
  const user = await requireOnboardedUser();
  const base = request.headers.get("origin") ?? "http://localhost:3000";

  // Read returnTo from form body so callers can control where we land after run
  const formData = await request.formData().catch(() => null);
  const returnTo = formData?.get("returnTo");
  const redirectDest = typeof returnTo === "string" && returnTo.startsWith("/")
    ? `${base}${returnTo}`
    : `${base}/scraper`;

  // Don't run if already in progress — just redirect back
  const { getWorkerStatus } = await import("@/lib/worker-state");
  if (getWorkerStatus().running) {
    return NextResponse.redirect(redirectDest);
  }

  markWorkerRunning();

  // Fire pipeline in background — respond immediately so browser doesn't hang
  void (async () => {
    try {
      const { runPipeline } = await import("../../../../../../worker/src/pipeline");
      console.log("[worker/run] pipeline starting for user", user.id);
      const result = await runPipeline({ onlyUserId: user.id });
      console.log("[worker/run] pipeline done:", JSON.stringify(result));
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

  return NextResponse.redirect(redirectDest);
}
