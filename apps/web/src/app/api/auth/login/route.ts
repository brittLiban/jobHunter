import { loginInputSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { logInUser } from "@/lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = loginInputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/login?error=invalid_login", request.url));
  }

  try {
    const user = await logInUser(parsed.data.email, parsed.data.password);
    const destination = user.onboardingCompletedAt ? "/dashboard" : "/onboarding";
    return NextResponse.redirect(new URL(destination, request.url));
  } catch {
    return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  }
}
