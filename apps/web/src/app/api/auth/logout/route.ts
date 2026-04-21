import { NextResponse } from "next/server";

import { logOutUser } from "@/lib/auth";

export async function POST(request: Request) {
  await logOutUser();
  return NextResponse.redirect(new URL("/", request.url));
}
