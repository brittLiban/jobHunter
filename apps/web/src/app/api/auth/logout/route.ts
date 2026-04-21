import { NextResponse } from "next/server";

import { logOutUser } from "@/lib/auth";
import { buildAppUrl } from "@/lib/redirects";

export async function POST(request: Request) {
  await logOutUser();
  return NextResponse.redirect(buildAppUrl("/", request));
}
