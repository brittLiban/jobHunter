import { signupInputSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { signUpUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = signupInputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
  });

  if (!parsed.success) {
    return NextResponse.redirect(buildAppUrl("/signup?error=invalid_signup", request));
  }

  try {
    await signUpUser(parsed.data);
  } catch {
    return NextResponse.redirect(buildAppUrl("/signup?error=signup_failed", request));
  }

  return NextResponse.redirect(buildAppUrl("/onboarding", request));
}
