import {
  findApplicationAutomationContextByUrl,
  getApplicationAutomationContext,
} from "@jobhunter/db";
import { NextResponse } from "next/server";

import { authenticateExtensionRequest } from "@/lib/extension-auth";
import { buildExtensionAutofillPacket } from "@/lib/extension-packet";

export async function GET(request: Request) {
  const token = await authenticateExtensionRequest(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized extension token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId")?.trim() ?? "";
  const pageUrl = url.searchParams.get("pageUrl")?.trim() ?? "";
  const refreshMaterials = parseBoolean(url.searchParams.get("refresh"));

  if (!applicationId && !pageUrl) {
    return NextResponse.json({
      error: "Provide applicationId or pageUrl.",
    }, { status: 400 });
  }

  const context = applicationId
    ? await getApplicationAutomationContext(token.userId, applicationId)
    : await findApplicationAutomationContextByUrl(token.userId, pageUrl);

  if (!context || !context.resume || !context.user.profile || !context.user.preferences) {
    return NextResponse.json({
      error: "No prepared application context matched this request.",
    }, { status: 404 });
  }

  const appBaseUrl = `${url.protocol}//${url.host}`;
  const packet = await buildExtensionAutofillPacket({
    context,
    appBaseUrl,
    refreshMaterials,
  });

  return NextResponse.json(packet, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
