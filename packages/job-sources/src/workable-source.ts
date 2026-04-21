import type { JobPosting } from "@jobhunter/core";

import {
  type JobSourceAdapter,
  normalizeJobPosting,
  stripHtml,
  type SourceDiscoveryTarget,
} from "./base";

const WORKABLE_XML_URL = "https://www.workable.com/boards/workable.xml";

export class WorkableJobSource implements JobSourceAdapter {
  kind = "workable" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const response = await fetch(WORKABLE_XML_URL, { cache: "no-store" }).catch(() => null);
    if (!response || !response.ok) {
      return [];
    }
    const xml = await response.text();
    const items = [...xml.matchAll(/<job>([\s\S]*?)<\/job>/g)].map((match) => match[1]);
    const discoveredAt = new Date().toISOString();

    return items
      .map((raw) => parseWorkableItem(raw, discoveredAt, target.sourceName))
      .filter((job): job is JobPosting => {
        if (!job) {
          return false;
        }
        return target.identifiers.some(({ slug, companyName }) => {
          const candidate = (companyName ?? slug).toLowerCase();
          return job.company.toLowerCase() === candidate;
        });
      });
  }
}

function parseWorkableItem(raw: string, discoveredAt: string, sourceName: string): JobPosting | null {
  const getTag = (tag: string) => {
    const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    return match?.[1]?.trim() ?? "";
  };

  const company = getTag("company");
  const url = getTag("url");
  if (!company || !url) {
    return null;
  }

  const location = [getTag("city"), getTag("state"), getTag("country")].filter(Boolean).join(", ");

  return normalizeJobPosting({
    id: `${company}:${url}`,
    externalId: url,
    sourceKind: "workable",
    sourceName,
    company,
    title: getTag("title") || "Untitled",
    location: location || (getTag("remote").toLowerCase() === "true" ? "Remote" : ""),
    salaryMin: undefined,
    salaryMax: undefined,
    salaryCurrency: "USD",
    description: stripHtml(getTag("description")),
    url,
    applyUrl: url,
    discoveredAt,
  });
}
