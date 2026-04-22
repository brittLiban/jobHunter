import { saveApplicationFieldOverrideForUser } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };
  const formData = await request.formData();
  const label = readFormValue(formData.get("label"));
  const value = readFormValue(formData.get("value"));

  if (!label) {
    return NextResponse.redirect(
      buildAppUrl(`/applications?focus=${encodeURIComponent(applicationId)}&override=blocked`, request),
    );
  }

  await saveApplicationFieldOverrideForUser({
    userId: user.id,
    applicationId,
    label,
    value,
  });

  return NextResponse.redirect(
    buildAppUrl(`/applications?focus=${encodeURIComponent(applicationId)}&override=1`, request),
  );
}

function readFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
