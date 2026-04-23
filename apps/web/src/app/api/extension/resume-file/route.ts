import { readFile } from "node:fs/promises";

import { resolveDataPath } from "@jobhunter/core";
import { getApplicationAutomationContext } from "@jobhunter/db";

import { authenticateExtensionRequest } from "@/lib/extension-auth";

export async function GET(request: Request) {
  const token = await authenticateExtensionRequest(request);
  if (!token) {
    return new Response("Unauthorized extension token.", { status: 401 });
  }

  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId")?.trim() ?? "";
  if (!applicationId) {
    return new Response("Missing applicationId.", { status: 400 });
  }

  const context = await getApplicationAutomationContext(token.userId, applicationId);
  if (!context || !context.resume) {
    return new Response("Application resume not found.", { status: 404 });
  }

  const filePath = resolveDataPath(context.resume.storageKey);
  const buffer = await readFile(filePath);
  const fileName = context.resume.originalFileName || "resume";

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": context.resume.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${sanitizeFileName(fileName)}"`,
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
