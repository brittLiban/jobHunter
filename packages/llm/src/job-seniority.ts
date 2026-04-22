import type {
  JobPosting,
  JobSeniorityAssessment,
} from "@jobhunter/core";

import { inferJobSeniorityFromText } from "@jobhunter/core";

import { findJobSeniorityAssessment, recordJobSeniorityAssessment } from "./job-seniority-cache";
import { buildJobSeniorityPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, type LLMProvider } from "./provider";

export class JobSeniorityClassifierService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

  async classify(input: { job: JobPosting }): Promise<JobSeniorityAssessment> {
    const cached = await findJobSeniorityAssessment(input.job);
    if (cached) {
      return cached;
    }

    const fallback = inferJobSeniorityFromText(input.job.title, input.job.description);
    const result = await this.llm.generateObject({
      ...buildJobSeniorityPrompt(input),
      fallback,
    });

    const normalized = normalizeAssessment(result) ?? fallback;
    await recordJobSeniorityAssessment(input.job, normalized);
    return normalized;
  }
}

function normalizeAssessment(value: unknown): JobSeniorityAssessment | null {
  if (!isRecord(value)) {
    return null;
  }

  const level = typeof value.level === "string" ? value.level : "";
  const confidence = typeof value.confidence === "number" ? value.confidence : 0;
  const reasoning = typeof value.reasoning === "string" ? value.reasoning : "";

  if (!["entry", "mid", "senior"].includes(level) || !reasoning) {
    return null;
  }

  return {
    level: level as JobSeniorityAssessment["level"],
    confidence: Math.max(0, Math.min(1, confidence)),
    reasoning,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
