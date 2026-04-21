import type { JobPosting, JobSourceKind } from "@jobhunter/core";

export type SourceIdentifier = {
  slug: string;
  companyName?: string;
};

export type SourceDiscoveryTarget = {
  kind: JobSourceKind;
  sourceName: string;
  identifiers: SourceIdentifier[];
};

export interface JobSourceAdapter {
  kind: JobSourceKind;
  discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]>;
}

export function normalizeJobPosting(job: JobPosting): JobPosting {
  return {
    ...job,
    company: job.company.trim(),
    title: job.title.trim(),
    location: job.location.trim(),
    description: job.description.trim(),
    url: normalizeJobUrl(job.url),
    applyUrl: job.applyUrl ? normalizeJobUrl(job.applyUrl) : undefined,
  };
}

export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.searchParams.has("gh_jid")) {
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}
