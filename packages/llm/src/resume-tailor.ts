import type { JobPosting, TailoredResumeDraft } from "@jobhunter/core";

import { buildResumeTailorPrompt } from "./prompt-templates";
import { FallbackLLMProvider, type LLMProvider } from "./job-scorer";

export class ResumeTailorService {
  constructor(private readonly llm: LLMProvider = new FallbackLLMProvider()) {}

  async tailor(input: {
    job: JobPosting;
    resumeText: string;
  }): Promise<TailoredResumeDraft> {
    const fallback: TailoredResumeDraft = {
      summaryLine: `${input.job.title} candidate with backend, automation, and production delivery experience.`,
      tailoredBullets: [
        "Built automation workflows that reduced repetitive manual work and improved reliability.",
        "Developed backend integrations and APIs that connected business systems and operational data.",
        "Improved software delivery quality through debugging, testing, and pragmatic CI/CD discipline.",
      ],
      keywordHighlights: ["automation", "APIs", "backend systems", "production delivery"],
    };

    return this.llm.generateObject({
      ...buildResumeTailorPrompt(input),
      fallback,
    });
  }
}
