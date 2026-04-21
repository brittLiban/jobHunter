import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await requireOnboardedUser();
  const { runPipeline } = await import("../../../../../../worker/src/pipeline");
  await runPipeline({ onlyUserId: user.id });
  return NextResponse.redirect(new URL("/dashboard?worker=ran", request.url));
}
