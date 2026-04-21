import type {
  FitAssessment,
  JobPosting,
  StructuredProfile,
  TailoredResumeDraft,
} from "@jobhunter/core";

export function buildJobScorerPrompt(input: {
  job: JobPosting;
  profile: StructuredProfile;
  resumeText: string;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "You score job fit conservatively. Respect hard business rules outside the model and never invent experience.",
    userPrompt: [
      "Score the candidate for this job and return fit score, apply or skip decision, confidence, top matches, and major gaps.",
      `Candidate profile: ${JSON.stringify(input.profile)}`,
      `Base resume: ${input.resumeText}`,
      `Job posting: ${JSON.stringify(input.job)}`,
    ].join("\n\n"),
  };
}

export function buildResumeTailorPrompt(input: {
  job: JobPosting;
  resumeText: string;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "Tailor resume content truthfully. Rewrite the summary and two to four bullets without inventing experience.",
    userPrompt: [
      "Create ATS-aware but natural resume tailoring for this role.",
      `Resume: ${input.resumeText}`,
      `Job: ${JSON.stringify(input.job)}`,
    ].join("\n\n"),
  };
}

export function buildShortAnswerPrompt(input: {
  job: JobPosting;
  profile: StructuredProfile;
  tailoredResume: TailoredResumeDraft;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "Write concise, human-sounding short application answers. Avoid repetitive phrasing and keep all statements truthful.",
    userPrompt: [
      "Generate short answers for why this role, why you are a fit, and anything else we should know.",
      `Candidate profile: ${JSON.stringify(input.profile)}`,
      `Tailored resume: ${JSON.stringify(input.tailoredResume)}`,
      `Job: ${JSON.stringify(input.job)}`,
    ].join("\n\n"),
  };
}

export function fallbackExplanation(fitAssessment: FitAssessment): string {
  return [
    `Score: ${fitAssessment.fitScore}`,
    `Decision: ${fitAssessment.decision}`,
    `Top matches: ${fitAssessment.topMatches.join(", ")}`,
    `Major gaps: ${fitAssessment.majorGaps.join(", ")}`,
  ].join(" | ");
}
