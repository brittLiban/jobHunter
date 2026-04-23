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
    return withExtensionCors(NextResponse.json({ error: "Unauthorized extension token." }, { status: 401 }));
  }

  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId")?.trim() ?? "";
  const pageUrl = url.searchParams.get("pageUrl")?.trim() ?? "";
  const refreshMaterials = parseBoolean(url.searchParams.get("refresh"));

  if (!applicationId && !pageUrl) {
    return withExtensionCors(NextResponse.json({
      error: "Provide applicationId or pageUrl.",
    }, { status: 400 }));
  }

  const context = applicationId
    ? await getApplicationAutomationContext(token.userId, applicationId)
    : await findApplicationAutomationContextByUrl(token.userId, pageUrl);

  if (!context || !context.resume || !context.user.profile || !context.user.preferences) {
    return withExtensionCors(NextResponse.json({
      error: "No prepared application context matched this request.",
    }, { status: 404 }));
  }

  const appBaseUrl = normalizeLoopbackOrigin(`${url.protocol}//${url.host}`);
  const packet = await buildExtensionAutofillPacket({
    context,
    appBaseUrl,
    refreshMaterials,
  });

  return withExtensionCors(NextResponse.json(packet, {
    headers: {
      "Cache-Control": "no-store",
    },
  }));
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders,
  });
}

function parseBoolean(value: string | null) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeLoopbackOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "0.0.0.0") {
      parsed.hostname = "localhost";
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, "");
  } catch {
    return origin;
  }
}

const extensionCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function withExtensionCors(response: NextResponse) {
  for (const [key, value] of Object.entries(extensionCorsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}
