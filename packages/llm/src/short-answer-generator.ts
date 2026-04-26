import type { GeneratedAnswerSet, JobPosting, StructuredProfile, TailoredResumeDraft } from "@jobhunter/core";

import { PhraseVariationTracker } from "@jobhunter/core";

import { buildShortAnswerPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, type LLMProvider } from "./provider";
import { findSemanticCacheValue, recordSemanticCacheValue } from "./semantic-cache";

export class ShortAnswerGeneratorService {
  constructor(
    private readonly llm: LLMProvider = createLLMProviderFromEnv(),
    private readonly variationTracker = new PhraseVariationTracker(),
  ) {}

  async generate(input: {
    job: JobPosting;
    profile: StructuredProfile;
    tailoredResume: TailoredResumeDraft;
  }): Promise<GeneratedAnswerSet> {
    const whyRolePlan = this.variationTracker.nextPlan();
    const whyFitPlan = this.variationTracker.nextPlan();
    const anythingElsePlan = this.variationTracker.nextPlan();

    const fallback: GeneratedAnswerSet = {
      items: [
        {
          kind: "why_role",
          question: "Why this role?",
          answer: `${whyRolePlan.opening} strong interest in roles where I can ${whyRolePlan.preferredVerb} reliable backend workflows and contribute quickly to production systems.`,
        },
        {
          kind: "why_fit",
          question: "Why are you a fit?",
          answer: `${whyFitPlan.opening.toLowerCase()} hands-on experience with automation, APIs, testing, and cross-functional delivery, which matches the practical scope of this role.`,
        },
        {
          kind: "anything_else",
          question: "Anything else we should know?",
          answer: `${anythingElsePlan.opening} a track record of learning new systems quickly, staying truthful about scope, and shipping steady improvements without a lot of overhead.`,
        },
      ],
    };

    const cacheInput = {
      job: {
        company: input.job.company,
        title: input.job.title,
        description: input.job.description,
      },
      profile: {
        currentTitle: input.profile.currentTitle,
        currentCompany: input.profile.currentCompany,
        yearsOfExperience: input.profile.yearsOfExperience,
      },
      tailoredResume: input.tailoredResume,
    };

    const cached = await findSemanticCacheValue<GeneratedAnswerSet>("short-answer-generator", cacheInput);
    if (cached) {
      return cached;
    }

    const result = await this.llm.generateObject({
      ...buildShortAnswerPrompt(input),
      fallback,
    });
    // Merge with fallback — Ollama sometimes omits fields or returns malformed items
    const merged: GeneratedAnswerSet = {
      items: Array.isArray(result.items) && result.items.length > 0
        ? result.items.map((item, i) => {
            const fb = fallback.items[i] ?? fallback.items[0];
            return {
              kind: item.kind ?? fb.kind,
              question: typeof item.question === "string" ? item.question : fb.question,
              answer: typeof item.answer === "string" && item.answer.trim()
                ? item.answer
                : fb.answer,
            };
          })
        : fallback.items,
    };
    await recordSemanticCacheValue("short-answer-generator", cacheInput, merged);
    return merged;
  }
}
