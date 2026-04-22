import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveDataPath } from "@jobhunter/core";

type CacheEntry = {
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
  hits: number;
};

type CacheStore = {
  entries: CacheEntry[];
};

const cachePath = resolveDataPath("cache", "llm-semantic-cache.json");

export async function findSemanticCacheValue<T>(namespace: string, input: unknown): Promise<T | null> {
  const key = createCacheKey(namespace, input);
  const store = await loadCacheStore();
  const entry = store.entries.find((item) => item.namespace === namespace && item.key === key);

  if (!entry) {
    return null;
  }

  entry.hits += 1;
  entry.updatedAt = new Date().toISOString();
  await saveCacheStore(store);
  return entry.value as T;
}

export async function recordSemanticCacheValue(namespace: string, input: unknown, value: unknown) {
  const key = createCacheKey(namespace, input);
  const store = await loadCacheStore();
  const existing = store.entries.find((item) => item.namespace === namespace && item.key === key);
  const now = new Date().toISOString();

  if (existing) {
    existing.value = value;
    existing.updatedAt = now;
    existing.hits += 1;
  } else {
    store.entries.push({
      namespace,
      key,
      value,
      updatedAt: now,
      hits: 1,
    });
  }

  await saveCacheStore(store);
}

function createCacheKey(namespace: string, input: unknown) {
  const normalized = stableStringify(normalizeCacheInput(input));
  return createHash("sha256").update(`${namespace}\n${normalized}`).digest("hex");
}

function normalizeCacheInput(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCacheInput(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeCacheInput(item)]),
    );
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
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
