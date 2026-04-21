import { loginInputSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { logInUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = loginInputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return NextResponse.redirect(buildAppUrl("/login?error=invalid_login", request));
  }

  try {
    const user = await logInUser(parsed.data.email, parsed.data.password);
    const destination = user.onboardingCompletedAt ? "/dashboard" : "/onboarding";
    return NextResponse.redirect(buildAppUrl(destination, request));
  } catch {
    return NextResponse.redirect(buildAppUrl("/login?error=login_failed", request));
  }
}
