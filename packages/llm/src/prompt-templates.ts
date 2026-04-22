import type {
  GeneratedAnswer,
  FitAssessment,
  JobSeniorityAssessment,
  JobPosting,
  StructuredProfile,
  StructuredApplicationDefaults,
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

export function buildJobSeniorityPrompt(input: {
  job: JobPosting;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You classify software jobs conservatively as entry, mid, or senior.",
      "Use the actual scope and expectations in the posting, not just one buzzword.",
      "Prioritize explicit title markers like intern, new grad, L2, senior, staff, lead, or manager over vague description text.",
      "Return JSON only and never invent facts that are not in the posting.",
    ].join(" "),
    userPrompt: [
      "Classify the role seniority and explain the signal briefly.",
      `Job: ${JSON.stringify(input.job)}`,
      "Response schema:",
      JSON.stringify({
        level: "entry | mid | senior",
        confidence: 0.0,
        reasoning: "short explanation",
      }, null, 2),
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

export function buildApplicationFieldResolverPrompt(input: {
  sourceHost: string;
  fieldLabel: string;
  defaults: StructuredApplicationDefaults;
  generatedAnswers: GeneratedAnswer[];
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You map job application field labels to existing prepared candidate data.",
      "Return JSON only.",
      "Never invent user data.",
      "Choose the single best target from the allowed list or return none.",
      "Prefer structured profile fields over free-text answers when both could work.",
    ].join(" "),
    userPrompt: [
      `Application host: ${input.sourceHost}`,
      `Field label: ${input.fieldLabel}`,
      "Allowed targets:",
      JSON.stringify({
        structured_field: [
          "fullLegalName",
          "firstName",
          "lastName",
          "email",
          "phone",
          "city",
          "state",
          "country",
          "linkedinUrl",
          "githubUrl",
          "portfolioUrl",
          "workAuthorization",
          "usCitizenStatus",
          "requiresVisaSponsorship",
          "veteranStatus",
          "disabilityStatus",
          "school",
          "degree",
          "graduationDate",
          "yearsOfExperience",
          "currentCompany",
          "currentTitle",
          "targetLocations",
          "workModes",
          "messagingOptIn",
        ],
        generated_answer: ["why_role", "why_fit", "anything_else"],
        tailored_summary: ["tailoredSummary"],
        none: ["none"],
      }, null, 2),
      "Prepared structured defaults:",
      JSON.stringify(input.defaults),
      "Prepared generated answers:",
      JSON.stringify(input.generatedAnswers),
      "Response schema:",
      JSON.stringify({
        kind: "structured_field | generated_answer | tailored_summary | none",
        target: "allowed target string or none",
        confidence: 0.0,
        reasoning: "short explanation",
      }, null, 2),
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

export function fallbackSeniorityExplanation(assessment: JobSeniorityAssessment) {
  return [
    `Level: ${assessment.level}`,
    `Confidence: ${assessment.confidence}`,
    `Reasoning: ${assessment.reasoning}`,
  ].join(" | ");
}
