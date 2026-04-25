import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  type SourceDiscoveryTarget,
} from "./base";

const ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true";

export class AshbyJobSource implements JobSourceAdapter {
  kind = "ashby" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(({ slug }) => this.fetchBoard(slug, target.sourceName)),
    );
    return groups.flat();
  }

  private async fetchBoard(slug: string, sourceName: string): Promise<JobPosting[]> {
    const response = await fetchWithTimeout(
      ASHBY_API.replace("{board}", encodeURIComponent(slug)),
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );

    if (!response?.ok) return [];

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      return [];
    }

    const discoveredAt = new Date().toISOString();
    const rawJobs = (payload.jobs ?? []) as Array<Record<string, unknown>>;

    return rawJobs
      .filter((job) => job.isListed !== false)
      .map((job) => {
        const jobUrl = String(job.jobUrl ?? job.applyUrl ?? "");
        if (!jobUrl) return null;

        // Build location string from address components
        const location =
          String(job.location ?? "") ||
          buildAshbyLocation(job.address as Record<string, unknown> | undefined);

        // Parse compensation
        let salaryMin: number | undefined;
        let salaryMax: number | undefined;
        const comp = job.compensation as Record<string, unknown> | undefined;
        if (comp) {
          const min = Number(comp.minValue ?? comp.min ?? 0);
          const max = Number(comp.maxValue ?? comp.max ?? 0);
          if (min > 0) salaryMin = min;
          if (max > 0) salaryMax = max;
        }

        // Ashby provides plain text description directly
        const description = String(job.descriptionPlain ?? job.descriptionSafeHtml ?? "");

        return normalizeJobPosting({
          id: String(job.id ?? `${slug}:${jobUrl}`),
          externalId: String(job.id ?? ""),
          sourceKind: this.kind,
          sourceName,
          company: slug,
          title: String(job.title ?? "Untitled"),
          location,
          salaryMin,
          salaryMax,
          salaryCurrency: String((comp as Record<string, unknown> | undefined)?.currency ?? "USD"),
          description,
          url: jobUrl,
          applyUrl: String(job.applyUrl ?? jobUrl),
          discoveredAt,
        });
      })
      .filter((job): job is JobPosting => job !== null);
  }
}

function buildAshbyLocation(address: Record<string, unknown> | undefined): string {
  if (!address) return "";
  const postal = address.postalAddress as Record<string, unknown> | undefined;
  if (!postal) return "";
  return [
    postal.addressLocality,
    postal.addressRegion,
    postal.addressCountry,
  ]
    .filter(Boolean)
    .join(", ");
}
