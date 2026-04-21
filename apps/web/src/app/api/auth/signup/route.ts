import { signupInputSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { signUpUser } from "@/lib/auth";

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = signupInputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/signup?error=invalid_signup", request.url));
  }

  try {
    await signUpUser(parsed.data);
  } catch {
    return NextResponse.redirect(new URL("/signup?error=signup_failed", request.url));
  }

  return NextResponse.redirect(new URL("/onboarding", request.url));
}
