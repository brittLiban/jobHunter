import { reopenApplicationForUser } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params;
  await reopenApplicationForUser(user.id, applicationId);
  return NextResponse.redirect(buildAppUrl("/applications?reopened=1", request));
}
