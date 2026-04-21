import { markNotificationRead } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  const user = await requireOnboardedUser();
  const { notificationId } = await context.params;
  await markNotificationRead(user.id, notificationId);
  return NextResponse.redirect(new URL("/dashboard?notification=read", request.url));
}
