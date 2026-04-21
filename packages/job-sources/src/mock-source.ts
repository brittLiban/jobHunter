import type { JobPosting } from "@jobhunter/core";

import { type JobSourceAdapter, normalizeJobPosting, type SourceDiscoveryTarget } from "./base";

export class MockJobSource implements JobSourceAdapter {
  kind = "mock" as const;

  async discoverJobs(target: SourceDiscoveryTarget): Promise<JobPosting[]> {
    const discoveredAt = new Date().toISOString();
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
          "Build APIs, automation hooks, internal tools, and partner integrations that make developer workflows faster and more reliable.",
        url: "https://mock.jobhunter.local/jobs/vercel-integrations",
        applyUrl: "https://mock.jobhunter.local/apply/vercel-integrations",
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
          "Own backend services, systems reliability, and product-facing APIs for collaboration-heavy experiences.",
        url: "https://mock.jobhunter.local/jobs/figma-backend",
        applyUrl: "https://mock.jobhunter.local/apply/figma-backend",
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
          "Ship software, automation, and internal platform improvements with strong engineering fundamentals and excellent execution discipline.",
        url: "https://mock.jobhunter.local/jobs/stripe-new-grad",
        applyUrl: "https://mock.jobhunter.local/apply/stripe-new-grad",
        discoveredAt,
      },
    ];

    return jobs.map((job) => normalizeJobPosting(job));
  }
}
