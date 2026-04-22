import { NextResponse } from "next/server";
import { getApplicationAutomationContext } from "@jobhunter/db";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };
  const application = await getApplicationAutomationContext(user.id, applicationId);

  if (!application) {
    return NextResponse.redirect(
      buildAppUrl("/applications?autofill=blocked&reason=Application%20not%20found.", request),
    );
  }

  const applyTarget = application.job.applyUrl ?? application.job.canonicalUrl;
  const appBaseUrl = buildAppUrl("/", request);

  if (isMockApplyTarget(applyTarget)) {
    const destination = new URL(applyTarget, appBaseUrl);
    destination.searchParams.set("applicationId", applicationId);
    destination.searchParams.set("autofill", "1");
    return NextResponse.redirect(destination);
  }

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

  if (result.redirectUrl) {
    return NextResponse.redirect(new URL(result.redirectUrl, appBaseUrl));
  }

  return NextResponse.redirect(
    buildAppUrl(`/applications?autofill=${encodeURIComponent(result.outcome)}`, request),
  );
}

function isMockApplyTarget(targetUrl: string) {
  return targetUrl.includes("/mock/apply/") || targetUrl.includes("/mock/jobs/");
}
