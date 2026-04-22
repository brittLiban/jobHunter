import type { JobPosting, TailoredResumeDraft } from "@jobhunter/core";

import { buildResumeTailorPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, type LLMProvider } from "./provider";
import { findSemanticCacheValue, recordSemanticCacheValue } from "./semantic-cache";

export class ResumeTailorService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

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

    const cacheInput = {
      job: {
        company: input.job.company,
        title: input.job.title,
        description: input.job.description,
      },
      resumeText: input.resumeText,
    };

    const cached = await findSemanticCacheValue<TailoredResumeDraft>("resume-tailor", cacheInput);
    if (cached) {
      return cached;
    }

    const result = await this.llm.generateObject({
      ...buildResumeTailorPrompt(input),
      fallback,
    });
    await recordSemanticCacheValue("resume-tailor", cacheInput, result);
    return result;
  }
}
