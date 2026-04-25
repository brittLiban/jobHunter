import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true";

export class GreenhouseJobSource implements JobSourceAdapter {
  kind = "greenhouse" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(({ slug }) => this.fetchBoard(slug, target.sourceName)),
    );
    return groups.flat();
  }

  private async fetchBoard(slug: string, sourceName: string): Promise<JobPosting[]> {
    const response = await fetchWithTimeout(
      GREENHOUSE_API.replace("{company}", encodeURIComponent(slug)),
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );

    if (!response?.ok) return [];

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      return [];
    }

    // The API returns company info at the top level
    const companyName = String(
      (payload.company as Record<string, unknown> | undefined)?.name ?? slug,
    );

    const discoveredAt = new Date().toISOString();
    const rawJobs = (payload.jobs ?? []) as Array<Record<string, unknown>>;

    return rawJobs
      .map((job) => {
        const url = String(job.absolute_url ?? "");
        if (!url) return null;

        // Salary from metadata array: [{id, name, value}]
        let salaryMin: number | undefined;
        let salaryMax: number | undefined;
        const metadata = Array.isArray(job.metadata)
          ? (job.metadata as Array<Record<string, unknown>>)
          : [];
        for (const meta of metadata) {
          const name = String(meta.name ?? "").toLowerCase();
          const value = meta.value;
          if (name.includes("salary") || name.includes("compensation") || name.includes("pay")) {
            if (typeof value === "object" && value !== null) {
              const comp = value as Record<string, unknown>;
              const min = Number(comp.min_value ?? comp.min ?? 0);
              const max = Number(comp.max_value ?? comp.max ?? 0);
              if (min > 0) salaryMin = min;
              if (max > 0) salaryMax = max;
            } else if (typeof value === "string") {
              // Parse "$120,000 - $160,000" style strings
              const nums = value.replace(/[$,]/g, "").match(/\d+/g);
              if (nums && nums.length >= 1) salaryMin = Number(nums[0]);
              if (nums && nums.length >= 2) salaryMax = Number(nums[1]);
            }
          }
        }

        const location = (job.location as Record<string, unknown> | undefined)?.name;

        return normalizeJobPosting({
          id: String(job.id ?? `${slug}:${url}`),
          externalId: String(job.id ?? ""),
          sourceKind: this.kind,
          sourceName,
          company: companyName,
          title: String(job.title ?? "Untitled"),
          location: String(location ?? ""),
          salaryMin,
          salaryMax,
          salaryCurrency: "USD",
          description: stripHtml(String(job.content ?? "")),
          url,
          applyUrl: url,
          discoveredAt,
        });
      })
      .filter((job): job is JobPosting => job !== null);
  }
}
