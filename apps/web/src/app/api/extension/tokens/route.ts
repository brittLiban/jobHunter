import {
  createExtensionTokenForUser,
  listExtensionTokensForUser,
} from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth";
import { createExtensionTokenMaterial } from "@/lib/extension-auth";

export async function GET() {
  const user = await requireCurrentUser();
  const tokens = await listExtensionTokensForUser(user.id);
  return NextResponse.json({
    tokens: tokens.map((token) => ({
      id: token.id,
      label: token.label,
      tokenPrefix: token.tokenPrefix,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      expiresAt: token.expiresAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const body = await parseJsonBody(request);
  const label = body?.label && typeof body.label === "string" ? body.label.trim() : "Browser extension";
  const expiresInDays = Number(body?.expiresInDays ?? 365);
  const expiresAt = Number.isFinite(expiresInDays) && expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const tokenMaterial = createExtensionTokenMaterial();
  const token = await createExtensionTokenForUser({
    userId: user.id,
    label: label || "Browser extension",
    tokenHash: tokenMaterial.tokenHash,
    tokenPrefix: tokenMaterial.tokenPrefix,
    expiresAt,
  });

  return NextResponse.json({
    token: tokenMaterial.rawToken,
    tokenId: token.id,
    tokenPrefix: token.tokenPrefix,
    expiresAt: token.expiresAt?.toISOString() ?? null,
  });
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}
