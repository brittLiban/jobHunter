import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };
  const { autofillApplicationForUser } = await import("../../../../../../../worker/src/pipeline");
  const result = await autofillApplicationForUser({
    userId: user.id,
    applicationId,
  });

  if (!result.ok) {
    return NextResponse.redirect(
      buildAppUrl(`/applications?autofill=blocked&reason=${encodeURIComponent(result.reason)}`, request),
    );
  }

  return NextResponse.redirect(
    buildAppUrl(`/applications?autofill=${encodeURIComponent(result.outcome)}`, request),
  );
}
