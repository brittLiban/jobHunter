import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { resolveDataPath, type JobPosting, type JobSeniorityAssessment } from "@jobhunter/core";

type CacheEntry = {
  key: string;
  assessment: JobSeniorityAssessment;
  updatedAt: string;
  hits: number;
};

type CacheStore = {
  entries: CacheEntry[];
};

const cachePath = resolveDataPath("cache", "job-seniority-cache.json");

export async function findJobSeniorityAssessment(job: JobPosting) {
  const key = createCacheKey(job);
  const store = await loadCacheStore();
  const match = store.entries.find((entry) => entry.key === key);
  if (!match) {
    return null;
  }

  match.hits += 1;
  match.updatedAt = new Date().toISOString();
  await saveCacheStore(store);
  return match.assessment;
}

export async function recordJobSeniorityAssessment(job: JobPosting, assessment: JobSeniorityAssessment) {
  const key = createCacheKey(job);
  const store = await loadCacheStore();
  const existing = store.entries.find((entry) => entry.key === key);
  const now = new Date().toISOString();

  if (existing) {
    existing.assessment = assessment;
    existing.updatedAt = now;
    existing.hits += 1;
  } else {
    store.entries.push({
      key,
      assessment,
      updatedAt: now,
      hits: 1,
    });
  }

  await saveCacheStore(store);
}

function createCacheKey(job: JobPosting) {
  const normalized = [
    job.sourceKind,
    job.company.trim().toLowerCase(),
    job.title.trim().toLowerCase(),
    job.location.trim().toLowerCase(),
    job.description.trim().toLowerCase(),
  ].join("\n");

  return createHash("sha256").update(normalized).digest("hex");
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
