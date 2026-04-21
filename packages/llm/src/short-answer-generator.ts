import type { GeneratedAnswerSet, JobPosting, StructuredProfile, TailoredResumeDraft } from "@jobhunter/core";

import { PhraseVariationTracker } from "@jobhunter/core";

import { buildShortAnswerPrompt } from "./prompt-templates";
import { FallbackLLMProvider, type LLMProvider } from "./job-scorer";

export class ShortAnswerGeneratorService {
  constructor(
    private readonly llm: LLMProvider = new FallbackLLMProvider(),
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

    return this.llm.generateObject({
      ...buildShortAnswerPrompt(input),
      fallback,
    });
  }
}
