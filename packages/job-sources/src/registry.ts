import type { JobPosting, JobSourceKind } from "@jobhunter/core";

import { type JobSourceAdapter, normalizeJobPosting, type SourceDiscoveryTarget } from "./base";
import { AdzunaJobSource } from "./adzuna-source";
import { AshbyJobSource } from "./ashby-source";
import { GreenhouseJobSource } from "./greenhouse-source";
import { LeverJobSource } from "./lever-source";
import { MockJobSource } from "./mock-source";
import { RemoteOKJobSource } from "./remoteok-source";
import { WorkableJobSource } from "./workable-source";

const registry: Record<JobSourceKind, JobSourceAdapter> = {
  mock:         new MockJobSource(),
  greenhouse:   new GreenhouseJobSource(),
  ashby:        new AshbyJobSource(),
  lever:        new LeverJobSource(),
  workable:     new WorkableJobSource(),
  remoteok:     new RemoteOKJobSource(),
  adzuna:       new AdzunaJobSource(),
  company_site: new MockJobSource(),
  extension:    new MockJobSource(),
};

export function getJobSourceAdapter(kind: JobSourceKind): JobSourceAdapter {
  return registry[kind];
}

export async function discoverJobsForTargets(targets: SourceDiscoveryTarget[]): Promise<JobPosting[]> {
  const groups = await Promise.allSettled(
    targets.map(async (target) => {
      const adapter = getJobSourceAdapter(target.kind);
      return adapter.discoverJobs(target);
    }),
  );

  const merged = new Map<string, JobPosting>();
  for (const result of groups) {
    if (result.status === "rejected") continue;
    for (const job of result.value.map(normalizeJobPosting)) {
      if (!job.url || !job.company || !job.title) continue;
      merged.set(job.url, job);
    }
  }

  return [...merged.values()];
}

// ─── Default board lists ──────────────────────────────────────────────────────
// These are the default company slugs used when no env var overrides are set.
// Every slug here maps to a public job board on the respective ATS.
// Invalid slugs are silently ignored (the API returns 404 / empty).

/** ~80 companies using Greenhouse */
const DEFAULT_GREENHOUSE: string[] = [
  // Fintech / Payments
  "stripe", "brex", "plaid", "robinhood", "coinbase", "chime", "mercury",
  "ramp", "gusto", "rippling", "adyen", "klarna",
  // AI / ML
  "anthropic", "cohere", "scale", "huggingface", "replit", "perplexity",
  // Infrastructure / DevTools
  "hashicorp", "cloudflare", "datadog", "confluent", "databricks", "snowflake",
  "mongodb", "elastic", "pagerduty", "splunk", "newrelic",
  // Productivity / SaaS
  "notion", "figma", "hubspot", "zendesk", "intercom", "loom",
  "miro", "airtable", "asana", "monday",
  // Consumer / Marketplace
  "airbnb", "lyft", "doordash", "instacart", "eventbrite", "bumble",
  // Security
  "snyk", "crowdstrike", "lacework", "okta", "1password",
  // Other high-signal tech
  "shopify", "twilio", "segment", "amplitude", "braze", "mixpanel",
  "sendgrid", "auth0", "netlify", "vercel-gh",
  // Gaming / Media
  "roblox", "epic-games", "canva",
];

/** ~30 companies using Ashby */
const DEFAULT_ASHBY: string[] = [
  // Dev tools / infra
  "vercel", "linear", "retool", "raycast", "supabase", "planetscale",
  "neon", "railway", "fly",
  // Productivity
  "loom", "pitch", "coda", "descript", "rows",
  // AI / agents
  "dust", "causal", "inngest", "trigger",
  // Security / Ops
  "incident-io", "grafana",
  // Other
  "mercury", "remote", "deel",
];

/** ~20 companies using Lever */
const DEFAULT_LEVER: string[] = [
  "box", "perplexityai", "yelp", "eventbrite", "squarespace",
  "thumbtack", "lattice", "greenhouse", "benchling", "mixmax",
  "clearbit", "gem", "ripple", "openai",
];

/** ~10 companies using Workable */
const DEFAULT_WORKABLE: string[] = [
  "hotjar", "typeform", "kayako", "workable", "personio",
];

// ─── Aggregator keyword defaults ─────────────────────────────────────────────

/** Default keyword queries sent to Adzuna (if configured) */
const DEFAULT_ADZUNA_QUERIES: Array<{ keywords: string; location: string }> = [
  { keywords: "software engineer",          location: "seattle" },
  { keywords: "software engineer",          location: "remote" },
  { keywords: "senior software engineer",   location: "seattle" },
  { keywords: "full stack engineer",        location: "seattle" },
  { keywords: "backend engineer",           location: "seattle" },
  { keywords: "frontend engineer",          location: "remote" },
  { keywords: "machine learning engineer",  location: "san francisco" },
  { keywords: "staff engineer",             location: "remote" },
];

/** Default RemoteOK tag filters */
const DEFAULT_REMOTEOK_TAGS = "engineer,typescript,python,react,golang,rust,devops";

// ─── Public builders ─────────────────────────────────────────────────────────

export function buildDefaultSourceTargetsFromEnv(): SourceDiscoveryTarget[] {
  const greenhouse = parseList(process.env.JOBHUNTER_GREENHOUSE_BOARDS, DEFAULT_GREENHOUSE);
  const ashby      = parseList(process.env.JOBHUNTER_ASHBY_BOARDS, DEFAULT_ASHBY);
  const lever      = parseList(process.env.JOBHUNTER_LEVER_SITES, DEFAULT_LEVER);
  const workable   = parseList(process.env.JOBHUNTER_WORKABLE_COMPANIES, DEFAULT_WORKABLE);

  // Adzuna queries: "keywords:location" pairs, comma-separated
  const rawAdzuna = process.env.JOBHUNTER_ADZUNA_QUERIES;
  const adzunaIdentifiers = rawAdzuna
    ? rawAdzuna.split("|").map((pair) => {
        const [kw, loc] = pair.split(":");
        return { slug: kw.trim(), companyName: loc?.trim() };
      })
    : DEFAULT_ADZUNA_QUERIES.map(({ keywords, location }) => ({
        slug: keywords,
        companyName: location,
      }));

  // RemoteOK tags
  const remoteokTags = process.env.JOBHUNTER_REMOTEOK_TAGS ?? DEFAULT_REMOTEOK_TAGS;

  return buildSourceTargetsFromBoards({
    greenhouse,
    ashby,
    lever,
    workable,
    adzunaIdentifiers,
    remoteokTags: remoteokTags.split(",").map((t) => t.trim()).filter(Boolean),
  });
}

export function buildSourceTargetsFromBoards(boards: {
  greenhouse: string[];
  ashby: string[];
  lever: string[];
  workable: string[];
  adzunaIdentifiers?: Array<{ slug: string; companyName?: string }>;
  remoteokTags?: string[];
}): SourceDiscoveryTarget[] {
  const targets: SourceDiscoveryTarget[] = [
    {
      kind: "mock",
      sourceName: "Mock Demo Feed",
      identifiers: [{ slug: "mock-demo-feed" }],
    },
    {
      kind: "greenhouse",
      sourceName: "Greenhouse",
      identifiers: boards.greenhouse.map((slug) => ({ slug })),
    },
    {
      kind: "ashby",
      sourceName: "Ashby",
      identifiers: boards.ashby.map((slug) => ({ slug })),
    },
    {
      kind: "lever",
      sourceName: "Lever",
      identifiers: boards.lever.map((slug) => ({ slug })),
    },
    {
      kind: "workable",
      sourceName: "Workable",
      identifiers: boards.workable.map((slug) => ({ slug, companyName: slug })),
    },
    {
      kind: "remoteok",
      sourceName: "RemoteOK",
      identifiers: [{ slug: boards.remoteokTags?.join(",") ?? DEFAULT_REMOTEOK_TAGS }],
    },
  ];

  // Only add Adzuna target if identifiers are provided and not empty
  const adzuna = boards.adzunaIdentifiers ?? DEFAULT_ADZUNA_QUERIES.map(({ keywords, location }) => ({
    slug: keywords,
    companyName: location,
  }));

  if (adzuna.length > 0) {
    targets.push({
      kind: "adzuna",
      sourceName: "Adzuna (Indeed/LinkedIn/Glassdoor)",
      identifiers: adzuna,
    });
  }

  return targets.filter((target) => target.identifiers.length > 0);
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  const source = raw?.trim() ? raw : fallback.join(",");
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
