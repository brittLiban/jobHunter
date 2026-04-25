import type { JobPosting, JobSourceKind } from "@jobhunter/core";

import { type JobSourceAdapter, normalizeJobPosting, type SourceDiscoveryTarget } from "./base";
import { AshbyJobSource } from "./ashby-source";
import { GreenhouseJobSource } from "./greenhouse-source";
import { LeverJobSource } from "./lever-source";
import { MockJobSource } from "./mock-source";
import { WorkableJobSource } from "./workable-source";

const registry: Record<JobSourceKind, JobSourceAdapter> = {
  mock: new MockJobSource(),
  greenhouse: new GreenhouseJobSource(),
  ashby: new AshbyJobSource(),
  lever: new LeverJobSource(),
  workable: new WorkableJobSource(),
  company_site: new MockJobSource(),
  extension: new MockJobSource(),
};

export function getJobSourceAdapter(kind: JobSourceKind): JobSourceAdapter {
  return registry[kind];
}

export async function discoverJobsForTargets(targets: SourceDiscoveryTarget[]): Promise<JobPosting[]> {
  const groups = await Promise.allSettled(
    targets.map(async (target) => {
      const adapter = getJobSourceAdapter(target.kind);
      return adapter.discoverJobs(target);
    }),
  );

  const merged = new Map<string, JobPosting>();
  for (const result of groups) {
    if (result.status === "rejected") continue;
    for (const job of result.value.map(normalizeJobPosting)) {
      if (!job.url || !job.company || !job.title) continue;
      merged.set(job.url, job);
    }
  }

  return [...merged.values()];
}

export function buildDefaultSourceTargetsFromEnv(): SourceDiscoveryTarget[] {
  return buildSourceTargetsFromBoards({
    greenhouse: parseList(process.env.JOBHUNTER_GREENHOUSE_BOARDS, ["stripe", "figma", "anthropic", "openai", "notion"]),
    ashby: parseList(process.env.JOBHUNTER_ASHBY_BOARDS, ["vercel", "retool", "linear", "raycast"]),
    lever: parseList(process.env.JOBHUNTER_LEVER_SITES, ["box", "perplexity"]),
    workable: parseList(process.env.JOBHUNTER_WORKABLE_COMPANIES, []),
  });
}

export function buildSourceTargetsFromBoards(boards: {
  greenhouse: string[];
  ashby: string[];
  lever: string[];
  workable: string[];
}): SourceDiscoveryTarget[] {
  const targets: SourceDiscoveryTarget[] = [
    {
      kind: "mock",
      sourceName: "Mock Demo Feed",
      identifiers: [{ slug: "mock-demo-feed" }],
    },
    {
      kind: "greenhouse",
      sourceName: "Greenhouse",
      identifiers: boards.greenhouse.map((slug) => ({ slug })),
    },
    {
      kind: "ashby",
      sourceName: "Ashby",
      identifiers: boards.ashby.map((slug) => ({ slug })),
    },
    {
      kind: "lever",
      sourceName: "Lever",
      identifiers: boards.lever.map((slug) => ({ slug })),
    },
    {
      kind: "workable",
      sourceName: "Workable",
      identifiers: boards.workable.map((slug) => ({ slug, companyName: slug })),
    },
  ];

  return targets.filter((target) => target.identifiers.length > 0);
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  const source = raw?.trim() ? raw : fallback.join(",");
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
