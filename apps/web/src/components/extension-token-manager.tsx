"use client";

import { useMemo, useState, useTransition } from "react";

type ExtensionTokenRecord = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export function ExtensionTokenManager({
  initialTokens,
}: {
  initialTokens: ExtensionTokenRecord[];
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [label, setLabel] = useState("Primary browser");
  const [expiresInDays, setExpiresInDays] = useState("365");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tokenCountLabel = useMemo(
    () => `${tokens.length} active token${tokens.length === 1 ? "" : "s"}`,
    [tokens.length],
  );

  function createToken() {
    setError(null);
    setNewToken(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/extension/tokens", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: label.trim() || "Browser extension",
            expiresInDays: Number(expiresInDays),
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to create token.");
        }
        const payload = await response.json() as {
          token: string;
          tokenId: string;
          tokenPrefix: string;
          expiresAt: string | null;
        };
        setNewToken(payload.token);
        const refresh = await fetch("/api/extension/tokens", { method: "GET" });
        const latest = await refresh.json() as { tokens: ExtensionTokenRecord[] };
        setTokens(latest.tokens);
      } catch {
        setError("Could not create extension token.");
      }
    });
  }

  function revokeToken(tokenId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/extension/tokens/${tokenId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Failed to revoke token.");
        }
        setTokens((current) => current.filter((item) => item.id !== tokenId));
      } catch {
        setError("Could not revoke extension token.");
      }
    });
  }

  return (
    <div className="stack-list">
      <div className="stack-item">
        <p>Create extension access token</p>
        <span>Use this token once in the extension popup. It grants packet + resume access for this account.</span>
        <div className="form-grid">
          <label className="form-field">
            <span>Token label</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Laptop Chrome"
            />
          </label>
          <label className="form-field">
            <span>Expires in days</span>
            <input
              type="number"
              min="1"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
          </label>
        </div>
        <button type="button" className="button button-primary" onClick={createToken} disabled={pending}>
          {pending ? "Working..." : "Create token"}
        </button>
        {newToken ? (
          <p className="row-help">
            Save now (shown once): <code>{newToken}</code>
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>

      <div className="stack-item">
        <p>Active tokens</p>
        <span>{tokenCountLabel}</span>
        {tokens.length === 0 ? (
          <p className="row-help">No active extension token yet.</p>
        ) : (
          <div className="stack-list">
            {tokens.map((token) => (
              <div key={token.id} className="stack-item">
                <p>{token.label}</p>
                <span>Prefix {token.tokenPrefix} | Created {new Date(token.createdAt).toLocaleString()}</span>
                <span>
                  Last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "Never"}
                  {token.expiresAt ? ` | Expires ${new Date(token.expiresAt).toLocaleDateString()}` : ""}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => revokeToken(token.id)}
                  disabled={pending}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
