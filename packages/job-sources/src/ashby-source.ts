import type { JobPosting } from "@jobhunter/core";

import {
  type JobSourceAdapter,
  normalizeJobPosting,
  type SourceDiscoveryTarget,
} from "./base";

const ASHBY_URL =
  "https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true";

export class AshbyJobSource implements JobSourceAdapter {
  kind = "ashby" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(async ({ slug }) => {
        const response = await fetch(ASHBY_URL.replace("{board}", slug), {
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

        return ((payload.jobs ?? []) as Array<Record<string, unknown>>)
          .filter((job) => job.isListed !== false)
          .map((job) => {
            const location =
              String(job.location ?? "") ||
              [
                (job.address as { postalAddress?: { addressLocality?: string } } | undefined)?.postalAddress?.addressLocality,
                (job.address as { postalAddress?: { addressRegion?: string } } | undefined)?.postalAddress?.addressRegion,
                (job.address as { postalAddress?: { addressCountry?: string } } | undefined)?.postalAddress?.addressCountry,
              ]
                .filter(Boolean)
                .join(", ");

            return normalizeJobPosting({
              id: String(job.id ?? `${slug}:${job.jobUrl}`),
              externalId: String(job.id ?? ""),
              sourceKind: this.kind,
              sourceName: target.sourceName,
              company: slug,
              title: String(job.title ?? "Untitled"),
              location,
              salaryMin: undefined,
              salaryMax: undefined,
              salaryCurrency: "USD",
              description: String(job.descriptionPlain ?? ""),
              url: String(job.jobUrl ?? job.applyUrl ?? ""),
              applyUrl: String(job.applyUrl ?? job.jobUrl ?? ""),
              discoveredAt,
            });
          });
      }),
    );

    return groups.flat();
  }
}
