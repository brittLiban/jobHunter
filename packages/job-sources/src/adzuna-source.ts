import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  type SourceDiscoveryTarget,
} from "./base";

// Adzuna API — aggregates listings from Indeed, LinkedIn, Glassdoor, and dozens more.
// Free tier: 250 requests/month. Register at: https://developer.adzuna.com
// Required env vars: ADZUNA_APP_ID, ADZUNA_APP_KEY
// Optional: ADZUNA_COUNTRY (default: "us"), ADZUNA_RESULTS_PER_PAGE (default: 50)

const ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs";
const MAX_PAGES = 3; // up to 150 jobs per keyword query (3 pages × 50)

type AdzunaResult = {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  created?: string;
  contract_type?: string;
  category?: { label?: string };
};

type AdzunaResponse = {
  results?: AdzunaResult[];
  count?: number;
};

export class AdzunaJobSource implements JobSourceAdapter {
  kind = "adzuna" as const;

  private appId  = process.env.ADZUNA_APP_ID ?? "";
  private appKey = process.env.ADZUNA_APP_KEY ?? "";
  private country = process.env.ADZUNA_COUNTRY ?? "us";
  private resultsPerPage = Number(process.env.ADZUNA_RESULTS_PER_PAGE ?? "50");

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    if (!this.appId || !this.appKey) {
      // Silently skip — not configured. Log once for visibility.
      console.warn("[adzuna] Skipped: ADZUNA_APP_ID and ADZUNA_APP_KEY are not set.");
      console.warn("[adzuna] Register free at https://developer.adzuna.com to enable.");
      return [];
    }

    // Each identifier represents one keyword query.
    // slug = search keywords (e.g. "software engineer")
    // companyName (optional) = location to filter (e.g. "seattle" or "remote")
    const all = await Promise.all(
      target.identifiers.map(({ slug, companyName: location }) =>
        this.fetchKeyword(slug, location, target.sourceName),
      ),
    );
    return all.flat();
  }

  private async fetchKeyword(
    keywords: string,
    location: string | undefined,
    sourceName: string,
  ): Promise<JobPosting[]> {
    const jobs: JobPosting[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = this.buildUrl(keywords, location, page);
      const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response?.ok) {
        if (response?.status === 401) {
          console.error("[adzuna] Invalid credentials — check ADZUNA_APP_ID and ADZUNA_APP_KEY.");
        }
        break;
      }

      let body: AdzunaResponse;
      try {
        body = await response.json() as AdzunaResponse;
      } catch {
        break;
      }

      const results = body.results ?? [];
      if (results.length === 0) break;

      const discoveredAt = new Date().toISOString();

      for (const r of results) {
        const url = r.redirect_url;
        if (!url) continue;

        const company = r.company?.display_name ?? "Unknown";
        const title = r.title ?? "Unknown Role";
        const locationStr = r.location?.display_name ?? location ?? "";

        jobs.push(normalizeJobPosting({
          id: String(r.id ?? url),
          externalId: String(r.id ?? ""),
          sourceKind: this.kind,
          sourceName,
          company,
          title,
          location: locationStr,
          salaryMin:       r.salary_min && r.salary_min > 0 ? r.salary_min : undefined,
          salaryMax:       r.salary_max && r.salary_max > 0 ? r.salary_max : undefined,
          salaryCurrency: "USD",
          description:    r.description ?? "",
          url,
          applyUrl:       url,
          discoveredAt,
        }));
      }

      // Stop paging if we got fewer results than a full page
      if (results.length < this.resultsPerPage) break;
    }

    return jobs;
  }

  private buildUrl(keywords: string, location: string | undefined, page: number): string {
    const params = new URLSearchParams({
      app_id:           this.appId,
      app_key:          this.appKey,
      results_per_page: String(this.resultsPerPage),
      what:             keywords,
      content_type:     "application/json",
    });

    if (location && location !== "all" && location !== "remote") {
      params.set("where", location);
    }

    if (location === "remote") {
      params.set("what", `${keywords} remote`);
    }

    return `${ADZUNA_BASE}/${this.country}/search/${page}?${params.toString()}`;
  }
}
