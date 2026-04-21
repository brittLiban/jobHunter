import { NextResponse } from "next/server";

import { demoDashboardSnapshot, structuredProfileFields } from "@jobhunter/core";

export async function GET() {
  return NextResponse.json({
    demoDashboardSnapshot,
    structuredProfileFields,
    nextServices: [
      "auth-and-onboarding",
      "resume-management",
      "job-source-sync",
      "playwright-applier",
    ],
  });
}
