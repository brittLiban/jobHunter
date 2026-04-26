import { onboardingInputSchema } from "@jobhunter/core";
import {
  getProfileBundle,
  upsertOnboardingData,
} from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth";
import { preferencesFromFormData, profileFromFormData } from "@/lib/forms";
import { buildAppUrl } from "@/lib/redirects";

export async function GET() {
  const user = await requireCurrentUser();
  const profile = await getProfileBundle(user.id);
  return NextResponse.json(profile);
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const formData = await request.formData();

  const parsed = onboardingInputSchema.safeParse({
    profile: profileFromFormData(formData),
    preferences: preferencesFromFormData(formData),
  });

  if (!parsed.success) {
    return NextResponse.redirect(buildAppUrl("/profile?error=invalid_profile", request));
  }

  await upsertOnboardingData(user.id, parsed.data, user.email);
  const returnTo = formData.get("returnTo");
  const dest = typeof returnTo === "string" && returnTo.startsWith("/") ? `${returnTo}?saved=1` : "/profile?saved=1";
  return NextResponse.redirect(buildAppUrl(dest, request));
}
