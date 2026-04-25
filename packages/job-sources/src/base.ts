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
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function stripHtml(html: string): string {
  return html
    // Convert block-level breaks to newlines before stripping tags
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Named entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x22;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    // Numeric HTML entities (decimal and hex)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Collapse whitespace but preserve single newlines
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fetch with a hard timeout. Returns null on timeout or network error. */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response | null> {
  const { timeoutMs = 12_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
