import type {
  FitAssessment,
  JobPosting,
  StructuredProfile,
  WeightedBreakdown,
} from "@jobhunter/core";

import { meetsFitThreshold } from "@jobhunter/core";

import { buildJobScorerPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, MockLLMProvider, type LLMProvider } from "./provider";
import { findSemanticCacheValue, recordSemanticCacheValue } from "./semantic-cache";

export class JobScorerService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

  async score(input: {
    job: JobPosting;
    profile: StructuredProfile;
    resumeText: string;
    threshold?: number;
  }): Promise<FitAssessment> {
    const breakdown = heuristicBreakdown(input.job.description, input.resumeText);
    const fitScore = Math.round(
      breakdown.skillOverlap * 0.25 +
        breakdown.techStackOverlap * 0.2 +
        breakdown.roleAlignment * 0.25 +
        breakdown.experienceLevelMatch * 0.15 +
        breakdown.locationAndAuthorizationFit * 0.15,
    );
    const fallback: FitAssessment = {
      fitScore,
      decision: meetsFitThreshold(fitScore, input.threshold ?? 70) ? "apply" : "skip",
      confidence: 0.78,
      topMatches: deriveTopMatches(input.job.description, input.resumeText),
      majorGaps: deriveMajorGaps(input.job.description, input.resumeText),
      weightedBreakdown: breakdown,
    };

    const cacheInput = {
      job: {
        company: input.job.company,
        title: input.job.title,
        location: input.job.location,
        description: input.job.description,
        sourceKind: input.job.sourceKind,
      },
      profile: {
        currentTitle: input.profile.currentTitle,
        yearsOfExperience: input.profile.yearsOfExperience,
        workAuthorization: input.profile.workAuthorization,
        country: input.profile.country,
      },
      resumeText: input.resumeText,
      threshold: input.threshold ?? 70,
    };

    const cached = await findSemanticCacheValue<FitAssessment>("job-scorer", cacheInput);
    if (cached) {
      return cached;
    }

    const result = await this.llm.generateObject({
      ...buildJobScorerPrompt(input),
      fallback,
    });
    await recordSemanticCacheValue("job-scorer", cacheInput, result);
    return result;
  }
}

export { MockLLMProvider };

function heuristicBreakdown(description: string, resumeText: string): WeightedBreakdown {
  const scoreFromTerms = (terms: string[]): number => {
    const haystack = `${description}\n${resumeText}`.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term)).length;
    return Math.min(100, 40 + hits * 12);
  };

  return {
    skillOverlap: scoreFromTerms(["typescript", "python", "api", "testing"]),
    techStackOverlap: scoreFromTerms(["postgres", "docker", "cloud", "automation"]),
    roleAlignment: scoreFromTerms(["software engineer", "backend", "platform"]),
    experienceLevelMatch: scoreFromTerms(["intern", "entry", "associate", "new grad"]),
    locationAndAuthorizationFit: 100,
  };
}

function deriveTopMatches(description: string, resumeText: string): string[] {
  const haystack = `${description}\n${resumeText}`.toLowerCase();
  const candidates = [
    "Strong overlap in backend and API work",
    "Relevant automation and workflow improvement experience",
    "Experience with cloud deployment and production delivery",
    "Good alignment with entry-to-mid software engineering responsibilities",
  ];

  return candidates.filter((item) => {
    const normalized = item.toLowerCase();
    return (
      normalized.includes("backend") ||
      haystack.includes("automation") ||
      haystack.includes("api") ||
      haystack.includes("cloud")
    );
  }).slice(0, 3);
}

function deriveMajorGaps(description: string, resumeText: string): string[] {
  const haystack = `${description}\n${resumeText}`.toLowerCase();
  const gaps: string[] = [];

  if (!haystack.includes("fintech")) {
    gaps.push("No direct domain evidence for this company vertical.");
  }
  if (!haystack.includes("distributed")) {
    gaps.push("Limited explicit distributed systems evidence in the base resume text.");
  }
  if (!haystack.includes("react")) {
    gaps.push("Frontend stack depth is not strongly represented in the base resume text.");
  }

  return gaps.slice(0, 3);
}
