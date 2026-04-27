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
  threshold?: number;
}): { systemPrompt: string; userPrompt: string } {
  const threshold = input.threshold ?? 70;
  return {
    systemPrompt: [
      "You are a job-fit scoring engine. Score how well a candidate's resume matches a job posting on a scale of 0–100.",
      "Be objective and evidence-based. A score of 70+ means the candidate meets most requirements and should apply.",
      "Common tech skills (Python, TypeScript, APIs, cloud, Docker) score positively when present in both job and resume.",
      "Entry-level and new-grad roles should score generously when the candidate has relevant internships or projects.",
      "Return ONLY valid JSON matching the exact schema provided — no extra text, no markdown fences.",
    ].join(" "),
    userPrompt: [
      "Score this candidate for the job posting below. Return JSON only.",
      "",
      `Candidate profile: ${JSON.stringify(input.profile)}`,
      "",
      `Resume: ${input.resumeText.slice(0, 3000)}`,
      "",
      `Job posting: ${JSON.stringify({
        company: input.job.company,
        title: input.job.title,
        location: input.job.location,
        description: (input.job.description ?? "").slice(0, 2000),
      })}`,
      "",
      "Response schema (return this exact shape, all fields required):",
      JSON.stringify({
        fitScore: "integer 0-100 — how well the candidate fits this specific job",
        decision: `"apply" if fitScore >= ${threshold}, otherwise "skip"`,
        confidence: "float 0.0-1.0 — your certainty in this score",
        topMatches: ["up to 3 short strings listing strongest alignment points"],
        majorGaps: ["up to 3 short strings listing the most significant gaps"],
        weightedBreakdown: {
          skillOverlap: "integer 0-100",
          techStackOverlap: "integer 0-100",
          roleAlignment: "integer 0-100",
          experienceLevelMatch: "integer 0-100",
          locationAndAuthorizationFit: "integer 0-100",
        },
      }, null, 2),
    ].join("\n"),
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

export function buildApplicationFieldAnswerSuggestionPrompt(input: {
  sourceHost: string;
  fieldLabel: string;
  defaults: StructuredApplicationDefaults;
  generatedAnswers: GeneratedAnswer[];
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You suggest an application answer for one specific field label.",
      "Return JSON only.",
      "Never invent facts.",
      "If the label is sensitive or uncertain (for example prior employer history), return shouldSuggest=false.",
      "Prefer direct concise answers that can be pasted into a form input.",
    ].join(" "),
    userPrompt: [
      `Application host: ${input.sourceHost}`,
      `Field label: ${input.fieldLabel}`,
      "Prepared structured defaults:",
      JSON.stringify(input.defaults),
      "Prepared generated answers:",
      JSON.stringify(input.generatedAnswers),
      "Response schema:",
      JSON.stringify({
        shouldSuggest: true,
        answer: "short answer or empty string",
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
