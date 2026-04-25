import type { JobPosting } from "@jobhunter/core";

import {
  fetchWithTimeout,
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

const LEVER_API = "https://api.lever.co/v0/postings/{site}?mode=json&limit=200&skip={skip}";
const MAX_PAGES = 5; // safety cap: up to 1000 jobs per company

export class LeverJobSource implements JobSourceAdapter {
  kind = "lever" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const groups = await Promise.all(
      target.identifiers.map(({ slug }) => this.fetchAllPages(slug, target.sourceName)),
    );
    return groups.flat();
  }

  private async fetchAllPages(slug: string, sourceName: string): Promise<JobPosting[]> {
    const all: JobPosting[] = [];
    const discoveredAt = new Date().toISOString();

    for (let page = 0; page < MAX_PAGES; page++) {
      const skip = page * 200;
      const url = LEVER_API.replace("{site}", encodeURIComponent(slug)).replace("{skip}", String(skip));
      const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response?.ok) break;

      let payload: Array<Record<string, unknown>>;
      try {
        payload = await response.json();
      } catch {
        break;
      }

      if (!Array.isArray(payload) || payload.length === 0) break;

      for (const job of payload) {
        const jobUrl = String(job.hostedUrl ?? "");
        if (!jobUrl) continue;

        const location = (job.categories as Record<string, unknown> | undefined)?.location;
        const commitment = (job.categories as Record<string, unknown> | undefined)?.commitment;
        const team = (job.categories as Record<string, unknown> | undefined)?.team;

        // Lever doesn't expose salary in public API — parse from description if present
        const rawDescription = String(job.descriptionPlain ?? job.description ?? "");
        const { salaryMin, salaryMax } = parseSalaryFromText(rawDescription);

        all.push(
          normalizeJobPosting({
            id: String(job.id ?? `${slug}:${jobUrl}`),
            externalId: String(job.id ?? ""),
            sourceKind: this.kind,
            sourceName,
            company: slug,
            title: String(job.text ?? "Untitled"),
            location: String(location ?? ""),
            salaryMin,
            salaryMax,
            salaryCurrency: "USD",
            description: stripHtml(rawDescription),
            url: jobUrl,
            applyUrl: String(job.applyUrl ?? jobUrl),
            discoveredAt,
            // Store team/commitment for potential future use
            ...(commitment ? {} : {}),
            ...(team ? {} : {}),
          }),
        );
      }

      // If fewer than 200 returned, no more pages
      if (payload.length < 200) break;
    }

    return all;
  }
}

/** Best-effort: parse "$120,000 - $160,000" or "120k-160k" patterns from description text */
function parseSalaryFromText(text: string): { salaryMin?: number; salaryMax?: number } {
  // Match patterns like $120,000 - $180,000 or 120k-180k or 120,000–180,000
  const rangePattern = /\$?([\d,]+)k?\s*[-–—to]+\s*\$?([\d,]+)k?/i;
  const match = text.match(rangePattern);
  if (!match) return {};

  const parseNum = (raw: string, isK: boolean) => {
    const n = Number(raw.replace(/,/g, ""));
    return isK || n < 1000 ? n * 1000 : n;
  };

  const hasK1 = match[0].toLowerCase().includes("k");
  const hasK2 = match[0].toLowerCase().includes("k");
  const min = parseNum(match[1], hasK1 && Number(match[1].replace(/,/g, "")) < 1000);
  const max = parseNum(match[2], hasK2 && Number(match[2].replace(/,/g, "")) < 1000);

  if (min > 10_000 && max > min) {
    return { salaryMin: min, salaryMax: max };
  }
  if (min > 10_000) {
    return { salaryMin: min };
  }
  return {};
}
