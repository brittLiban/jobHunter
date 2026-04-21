import { jobsResponseSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { loadJobsPageData } from "@/lib/page-data";

export async function GET() {
  const user = await requireOnboardedUser();
  const jobs = await loadJobsPageData(user.id);
  return NextResponse.json(jobsResponseSchema.parse({ jobs }));
}
