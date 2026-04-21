import type { JobPosting } from "@jobhunter/core";

import {
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

const GREENHOUSE_URL =
  "https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true";

export class GreenhouseJobSource implements JobSourceAdapter {
  kind = "greenhouse" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const jobs = await Promise.all(
      target.identifiers.map(async ({ slug }) => {
        const response = await fetch(GREENHOUSE_URL.replace("{company}", slug), {
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        }).catch(() => null);
        if (!response || !response.ok) {
          return [] as JobPosting[];
        }
        const payload = await response.json();
        const discoveredAt = new Date().toISOString();
        return ((payload.jobs ?? []) as Array<Record<string, unknown>>).map((job) =>
          normalizeJobPosting({
            id: String(job.id ?? `${slug}:${job.absolute_url}`),
            externalId: String(job.id ?? ""),
            sourceKind: this.kind,
            sourceName: target.sourceName,
            company: slug,
            title: String(job.title ?? "Untitled"),
            location: String((job.location as { name?: string } | undefined)?.name ?? ""),
            salaryMin: undefined,
            salaryMax: undefined,
            salaryCurrency: "USD",
            description: stripHtml(String(job.content ?? "")),
            url: String(job.absolute_url ?? ""),
            applyUrl: String(job.absolute_url ?? ""),
            discoveredAt,
          }),
        );
      }),
    );

    return jobs.flat();
  }
}
