import type { JobPosting } from "@jobhunter/core";

import {
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

const LEVER_URL =
  "https://api.lever.co/v0/postings/{site}?mode=json&skip=0&limit=100";

export class LeverJobSource implements JobSourceAdapter {
  kind = "lever" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(async ({ slug }) => {
        const response = await fetch(LEVER_URL.replace("{site}", slug), {
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
        return (payload as Array<Record<string, unknown>>).map((job) =>
          normalizeJobPosting({
            id: String(job.id ?? `${slug}:${job.hostedUrl}`),
            externalId: String(job.id ?? ""),
            sourceKind: this.kind,
            sourceName: target.sourceName,
            company: slug,
            title: String(job.text ?? "Untitled"),
            location: String((job.categories as { location?: string } | undefined)?.location ?? ""),
            salaryMin: undefined,
            salaryMax: undefined,
            salaryCurrency: "USD",
            description: stripHtml(String(job.descriptionPlain ?? job.description ?? "")),
            url: String(job.hostedUrl ?? ""),
            applyUrl: String(job.applyUrl ?? job.hostedUrl ?? ""),
            discoveredAt,
          }),
        );
      }),
    );

    return groups.flat();
  }
}
