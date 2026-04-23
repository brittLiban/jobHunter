import { revokeExtensionTokenForUser } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireCurrentUser();
  const { tokenId } = await context.params as { tokenId: string };
  if (!tokenId) {
    return NextResponse.json({ error: "Missing token id." }, { status: 400 });
  }

  const revoked = await revokeExtensionTokenForUser({
    userId: user.id,
    tokenId,
  });
  if (!revoked) {
    return NextResponse.json({ error: "Token not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
