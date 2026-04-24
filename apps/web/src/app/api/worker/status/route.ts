import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { getWorkerStatus } from "@/lib/worker-state";

export async function GET() {
  await requireOnboardedUser();
  const status = getWorkerStatus();
  return NextResponse.json(status);
}
