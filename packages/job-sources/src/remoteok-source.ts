import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  type SourceDiscoveryTarget,
} from "./base";

// RemoteOK public API — no auth required, returns ~300-500 remote tech jobs
const REMOTEOK_API = "https://remoteok.com/api";

type RemoteOKJob = {
  id?: string | number;
  slug?: string;
  company?: string;
  company_logo?: string;
  position?: string;
  description?: string;
  url?: string;
  apply_url?: string;
  date?: string;
  location?: string;
  tags?: string[];
  salary_min?: number | string;
  salary_max?: number | string;
  currency?: string;
};

export class RemoteOKJobSource implements JobSourceAdapter {
  kind = "remoteok" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    // identifiers[0].slug = comma-separated tag filter, e.g. "engineer,typescript"
    // If slug is "all" or empty, return all jobs
    const tagFilter = target.identifiers
      .flatMap((id) => id.slug.split(",").map((t) => t.trim().toLowerCase()))
      .filter((t) => t && t !== "all");

    const response = await fetchWithTimeout(REMOTEOK_API, {
      headers: {
        Accept: "application/json",
        "User-Agent": "JobHunter/1.0 (job aggregator; contact via GitHub)",
      },
      cache: "no-store",
    });

    if (!response?.ok) return [];

    let raw: unknown[];
    try {
      raw = await response.json();
    } catch {
      return [];
    }

    // First element is legal metadata, not a job
    const jobs = raw.slice(1) as RemoteOKJob[];
    const discoveredAt = new Date().toISOString();

    return jobs
      .filter((job) => {
        if (!job.position || !job.company || !job.url) return false;
        // Apply tag filter if specified
        if (tagFilter.length === 0) return true;
        const jobTags = (job.tags ?? []).map((t) => t.toLowerCase());
        return tagFilter.some((f) => jobTags.some((jt) => jt.includes(f)));
      })
      .map((job): JobPosting | null => {
        const url = job.url ? String(job.url) : null;
        if (!url) return null;

        const salaryMin = parseSalary(job.salary_min);
        const salaryMax = parseSalary(job.salary_max);

        return normalizeJobPosting({
          id: String(job.id ?? job.slug ?? url),
          externalId: String(job.id ?? ""),
          sourceKind: this.kind,
          sourceName: target.sourceName,
          company: String(job.company ?? "Unknown"),
          title: String(job.position ?? "Unknown Role"),
          location: String(job.location ?? "Remote"),
          salaryMin,
          salaryMax,
          salaryCurrency: String(job.currency ?? "USD"),
          description: stripTags(String(job.description ?? "")),
          url,
          applyUrl: job.apply_url ? String(job.apply_url) : url,
          discoveredAt,
        });
      })
      .filter((j): j is JobPosting => j !== null);
  }
}

function parseSalary(val: number | string | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  const n = typeof val === "number" ? val : Number(String(val).replace(/[^0-9.]/g, ""));
  return n > 0 ? n : undefined;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
