import { onboardingInputSchema } from "@jobhunter/core";
import { upsertOnboardingData } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth";
import { preferencesFromFormData, profileFromFormData } from "@/lib/forms";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const formData = await request.formData();

  const parsed = onboardingInputSchema.safeParse({
    profile: profileFromFormData(formData),
    preferences: preferencesFromFormData(formData),
  });

  if (!parsed.success) {
    return NextResponse.redirect(buildAppUrl("/onboarding?error=invalid_profile", request));
  }

  await upsertOnboardingData(user.id, parsed.data, user.email);
  return NextResponse.redirect(buildAppUrl("/dashboard", request));
}
