import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveDataPath } from "@jobhunter/core";

import type { FieldResolutionStrategy } from "./field-mapping";
import { normalizeLabel } from "./field-mapping";

type CacheEntry = {
  sourceHost: string;
  normalizedLabel: string;
  strategy: FieldResolutionStrategy;
  resolutionSource: "heuristic" | "llm";
  createdAt: string;
  updatedAt: string;
  hits: number;
};

type CacheStore = {
  entries: CacheEntry[];
};

const cachePath = resolveDataPath("cache", "field-resolution-cache.json");

export async function findSemanticResolution(input: {
  sourceHost: string;
  label: string;
  minimumScore?: number;
}) {
  const normalizedLabel = normalizeLabel(input.label);
  if (!normalizedLabel) {
    return null;
  }

  const store = await loadCacheStore();
  const candidates = store.entries
    .filter((entry) => entry.sourceHost === input.sourceHost)
    .map((entry) => ({
      entry,
      score: similarityScore(normalizedLabel, entry.normalizedLabel),
    }))
    .filter((item) => item.score >= (input.minimumScore ?? 0.72))
    .sort((left, right) => right.score - left.score || right.entry.hits - left.entry.hits);

  const match = candidates[0];
  if (!match) {
    return null;
  }

  match.entry.hits += 1;
  match.entry.updatedAt = new Date().toISOString();
  await saveCacheStore(store);

  return {
    strategy: match.entry.strategy,
    score: match.score,
    resolutionSource: match.entry.resolutionSource,
  };
}

export async function recordSemanticResolution(input: {
  sourceHost: string;
  label: string;
  strategy: FieldResolutionStrategy;
  resolutionSource: "heuristic" | "llm";
}) {
  const normalizedLabel = normalizeLabel(input.label);
  if (!normalizedLabel) {
    return;
  }

  const store = await loadCacheStore();
  const now = new Date().toISOString();
  const existing = store.entries.find((entry) =>
    entry.sourceHost === input.sourceHost && entry.normalizedLabel === normalizedLabel,
  );

  if (existing) {
    existing.strategy = input.strategy;
    existing.resolutionSource = input.resolutionSource;
    existing.hits += 1;
    existing.updatedAt = now;
  } else {
    store.entries.push({
      sourceHost: input.sourceHost,
      normalizedLabel,
      strategy: input.strategy,
      resolutionSource: input.resolutionSource,
      createdAt: now,
      updatedAt: now,
      hits: 1,
    });
  }

  await saveCacheStore(store);
}

async function loadCacheStore(): Promise<CacheStore> {
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as CacheStore;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

async function saveCacheStore(store: CacheStore) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(store, null, 2), "utf8");
}

function similarityScore(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function tokenize(value: string) {
  return new Set(
    normalizeLabel(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}
