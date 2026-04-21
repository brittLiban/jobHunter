import { NextResponse } from "next/server";

import { demoDashboardSnapshot, structuredProfileFields } from "@jobhunter/core";

export async function GET() {
  return NextResponse.json({
    demoDashboardSnapshot,
    structuredProfileFields,
    implementedServices: [
      "credential-auth",
      "onboarding",
      "resume-management",
      "prisma-dashboard",
      "job-source-sync",
      "greenhouse-automation",
      "manual-action-tracking",
    ],
    nextServices: [
      "oauth-hardening",
      "queue-scheduling",
      "broader-ats-automation",
      "integration-tests",
    ],
  });
}
