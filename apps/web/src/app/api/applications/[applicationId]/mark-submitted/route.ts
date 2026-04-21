import { markApplicationSubmittedForUser } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };
  await markApplicationSubmittedForUser(user.id, applicationId);
  return NextResponse.redirect(buildAppUrl("/applications?submitted=1", request));
}
