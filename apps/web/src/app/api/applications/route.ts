import { applicationsResponseSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { loadApplicationsPageData } from "@/lib/page-data";

export async function GET() {
  const user = await requireOnboardedUser();
  const applications = await loadApplicationsPageData(user.id);
  return NextResponse.json(applicationsResponseSchema.parse({ applications }));
}
