import { notificationsResponseSchema } from "@jobhunter/core";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";
import { loadNotificationsPageData } from "@/lib/page-data";

export async function GET() {
  const user = await requireOnboardedUser();
  const notifications = await loadNotificationsPageData(user.id);
  return NextResponse.json(notificationsResponseSchema.parse({ notifications }));
}
