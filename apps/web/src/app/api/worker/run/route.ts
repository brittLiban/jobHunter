import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(request: Request) {
  const user = await requireOnboardedUser();
  const { runPipeline } = await import("../../../../../../worker/src/pipeline");
  await runPipeline({ onlyUserId: user.id });
  return NextResponse.redirect(buildAppUrl("/dashboard?worker=ran", request));
}
