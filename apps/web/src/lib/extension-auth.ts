import { createHash, randomBytes } from "node:crypto";

import { resolveExtensionToken } from "@jobhunter/db";

const TOKEN_PREFIX_LENGTH = 10;

export function createExtensionTokenMaterial() {
  const rawToken = `jhx_${randomBytes(32).toString("hex")}`;
  const tokenHash = hashExtensionToken(rawToken);
  const tokenPrefix = rawToken.slice(0, TOKEN_PREFIX_LENGTH);
  return {
    rawToken,
    tokenHash,
    tokenPrefix,
  };
}

export function hashExtensionToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function authenticateExtensionRequest(request: Request) {
  const rawToken = readBearerToken(request);
  if (!rawToken) {
    return null;
  }
  return resolveExtensionToken(hashExtensionToken(rawToken));
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}
