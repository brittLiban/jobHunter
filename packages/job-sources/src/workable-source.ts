import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

/**
 * Workable public job board API.
 * Each company has its own subdomain board accessible at:
 *   GET https://apply.workable.com/api/v3/accounts/{slug}/jobs
 * Returns { results: Job[], nextPage?: string }
 */
const WORKABLE_API = "https://apply.workable.com/api/v3/accounts/{slug}/jobs";
const MAX_PAGES = 5;

export class WorkableJobSource implements JobSourceAdapter {
  kind = "workable" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(({ slug, companyName }) =>
        this.fetchAllPages(slug, companyName ?? slug, target.sourceName),
      ),
    );
    return groups.flat();
  }

  private async fetchAllPages(
    slug: string,
    companyName: string,
    sourceName: string,
  ): Promise<JobPosting[]> {
    const all: JobPosting[] = [];
    const discoveredAt = new Date().toISOString();
    let nextPage: string | undefined;
    let pageCount = 0;

    while (pageCount < MAX_PAGES) {
      const url = nextPage ?? WORKABLE_API.replace("{slug}", encodeURIComponent(slug));
      const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response?.ok) break;

      let payload: Record<string, unknown>;
      try {
        payload = await response.json();
      } catch {
        break;
      }

      const results = (payload.results ?? []) as Array<Record<string, unknown>>;
      if (results.length === 0) break;

      for (const job of results) {
        const jobUrl = String(job.url ?? job.shortlink ?? "");
        if (!jobUrl) continue;

        const location = buildWorkableLocation(job);
        const workMode = resolveWorkMode(job);

        all.push(
          normalizeJobPosting({
            id: String(job.id ?? job.shortcode ?? `${slug}:${jobUrl}`),
            externalId: String(job.id ?? job.shortcode ?? ""),
            sourceKind: this.kind,
            sourceName,
            company: companyName,
            title: String(job.title ?? "Untitled"),
            location,
            salaryMin: undefined,
            salaryMax: undefined,
            salaryCurrency: "USD",
            description: stripHtml(String(job.description ?? job.full_description ?? "")),
            url: jobUrl,
            applyUrl: jobUrl,
            workMode,
            discoveredAt,
          }),
        );
      }

      nextPage = typeof payload.nextPage === "string" ? payload.nextPage : undefined;
      if (!nextPage) break;
      pageCount++;
    }

    return all;
  }
}

function buildWorkableLocation(job: Record<string, unknown>): string {
  const loc = job.location as Record<string, unknown> | undefined;
  if (!loc) return "";

  if (loc.telecommuting === true || job.remote === true) {
    const country = String(loc.country ?? "");
    return country ? `Remote — ${country}` : "Remote";
  }

  return [loc.city, loc.region, loc.country]
    .filter(Boolean)
    .join(", ");
}

function resolveWorkMode(
  job: Record<string, unknown>,
): "remote" | "hybrid" | "on_site" | "flexible" | undefined {
  const loc = job.location as Record<string, unknown> | undefined;
  if (loc?.telecommuting === true || job.remote === true) return "remote";
  const workplaceType = String(job.workplace_type ?? "").toLowerCase();
  if (workplaceType.includes("remote")) return "remote";
  if (workplaceType.includes("hybrid")) return "hybrid";
  if (workplaceType.includes("on-site") || workplaceType.includes("onsite")) return "on_site";
  return undefined;
}
