import type { JobPosting } from "@jobhunter/core";

import { type JobSourceAdapter, normalizeJobPosting, type SourceDiscoveryTarget } from "./base";

export class MockJobSource implements JobSourceAdapter {
  kind = "mock" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const discoveredAt = new Date().toISOString();
    const appBaseUrl = resolveMockBaseUrl();
    const jobs: JobPosting[] = [
      {
        id: "mock_1",
        externalId: "mock-vercel-integrations",
        sourceKind: "mock",
        sourceName: target.sourceName,
        company: "Vercel",
        title: "Software Engineer, Integrations",
        location: "Remote - United States",
        workMode: "remote",
        salaryMin: 150000,
        salaryMax: 185000,
        salaryCurrency: "USD",
        description:
          "Build TypeScript APIs, automation hooks, Docker-backed internal tools, and platform integrations that make developer workflows faster and more reliable.",
        url: `${appBaseUrl}/mock/jobs/vercel-integrations`,
        applyUrl: `${appBaseUrl}/mock/apply/vercel-integrations`,
        discoveredAt,
      },
      {
        id: "mock_2",
        externalId: "mock-figma-backend",
        sourceKind: "mock",
        sourceName: target.sourceName,
        company: "Figma",
        title: "Backend Engineer",
        location: "Seattle, WA",
        workMode: "hybrid",
        salaryMin: 165000,
        salaryMax: 205000,
        salaryCurrency: "USD",
        description:
          "Own backend services, product-facing APIs, testing discipline, and cloud reliability for collaboration-heavy experiences built on TypeScript platforms.",
        url: `${appBaseUrl}/mock/jobs/figma-backend`,
        applyUrl: `${appBaseUrl}/mock/apply/figma-backend`,
        discoveredAt,
      },
      {
        id: "mock_3",
        externalId: "mock-stripe-new-grad",
        sourceKind: "mock",
        sourceName: target.sourceName,
        company: "Stripe",
        title: "Software Engineer, New Grad",
        location: "Remote within U.S.",
        workMode: "remote",
        salaryMin: 145000,
        salaryMax: 180000,
        salaryCurrency: "USD",
        description:
          "Ship software as a new grad engineer across backend APIs, automation, testing, and internal platform improvements with strong engineering fundamentals.",
        url: `${appBaseUrl}/mock/jobs/stripe-new-grad`,
        applyUrl: `${appBaseUrl}/mock/apply/stripe-new-grad`,
        discoveredAt,
      },
    ];

    return jobs.map((job) => normalizeJobPosting(job));
  }
}

function resolveMockBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
