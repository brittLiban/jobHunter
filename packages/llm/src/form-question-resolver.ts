import type { JobPreferences, StructuredProfile } from "@jobhunter/core";

import { createLLMProviderFromEnv, type LLMProvider } from "./provider";

export type FormQuestion = {
  label: string;
  type: "select" | "radio" | "checkbox" | "text" | "textarea";
  options?: string[];
  required?: boolean;
};

/**
 * Uses the LLM to resolve every visible form question to a concrete answer.
 *
 * For select/radio/checkbox questions it picks the exact option text.
 * For text/textarea it writes a short truthful answer from the profile.
 *
 * Returns a fieldOverrides map: { "Are you authorized to work?": "Yes", ... }
 * The content-script applies overrides at highest priority — no rule-based guessing needed.
 */
export class FormQuestionResolverService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

  async resolve(input: {
    questions: FormQuestion[];
    profile: StructuredProfile;
    preferences: Pick<JobPreferences, "workModes" | "targetRoles" | "locations">;
  }): Promise<Record<string, string>> {
    if (input.questions.length === 0) return {};

    // Only send questions the rules struggle with: choices + short-text unknowns.
    // Plain identity fields (name/email/phone) are handled reliably by rules already.
    const relevant = input.questions.filter((q) => {
      const l = q.label.toLowerCase();
      if (["first name", "last name", "full name", "email", "phone"].some((s) => l.includes(s))) {
        return false;
      }
      return true;
    });

    if (relevant.length === 0) return {};

    const systemPrompt = buildSystemPrompt();
    const userPrompt   = buildUserPrompt(relevant, input.profile, input.preferences);

    const result = await this.llm.generateObject<Record<string, string>>({
      systemPrompt,
      userPrompt,
      fallback: {},
    });

    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      return {};
    }

    // Validate: values must be non-empty strings
    return Object.fromEntries(
      Object.entries(result)
        .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
        .map(([k, v]) => [k, String(v).trim()]),
    );
  }
}

function buildSystemPrompt(): string {
  return `\
You are a job application assistant. Your job is to fill out a form on behalf of the applicant.

RULES:
1. For "select", "radio", or "checkbox" questions: your answer MUST be copied VERBATIM from the provided options list. Do not paraphrase.
2. For yes/no questions: answer exactly "Yes" or "No".
3. For "text" or "textarea" questions: write a concise, truthful answer based only on the profile.
4. If you genuinely cannot determine the correct answer, return an empty string "" for that key.
5. Return ONLY a valid JSON object — no markdown, no explanation, no code fences.
   Example: {"Are you authorized to work?": "Yes", "Country of residence": "US"}`;
}

function buildUserPrompt(
  questions: FormQuestion[],
  profile: StructuredProfile,
  preferences: Pick<JobPreferences, "workModes" | "targetRoles" | "locations">,
): string {
  const profileLines = [
    `Full name: ${profile.fullLegalName}`,
    `Location: ${[profile.city, profile.state, profile.country].filter(Boolean).join(", ")}`,
    `Work authorization: ${profile.workAuthorization}`,
    `US citizen status: ${profile.usCitizenStatus}`,
    `Requires visa sponsorship: ${String(profile.requiresVisaSponsorship)}`,
    `Veteran status: ${profile.veteranStatus}`,
    `Disability status: ${profile.disabilityStatus ?? "Prefer not to say"}`,
    `Gender: ${profile.gender ?? "Prefer not to say"}`,
    `Ethnicity / Hispanic or Latino: ${profile.ethnicity ?? "Prefer not to say"}`,
    `Preferred work modes: ${preferences.workModes.join(", ")}`,
    `Target roles: ${preferences.targetRoles.join(", ")}`,
    `Target locations: ${preferences.locations.join(", ")}`,
    `Current company: ${profile.currentCompany}`,
    `Current title: ${profile.currentTitle}`,
    `Years of experience: ${profile.yearsOfExperience}`,
    `Education: ${profile.degree} — ${profile.school}`,
    `LinkedIn: ${profile.linkedinUrl ?? "not provided"}`,
    `GitHub: ${profile.githubUrl ?? "not provided"}`,
    `Portfolio: ${profile.portfolioUrl ?? "not provided"}`,
  ].join("\n");

  const questionLines = questions.map((q, i) => {
    const lines = [
      `${i + 1}. Label: "${q.label}"`,
      `   Type: ${q.type}${q.required ? " (required)" : ""}`,
    ];
    if (q.options && q.options.length > 0) {
      lines.push(`   Options: ${q.options.map((o) => `"${o}"`).join(", ")}`);
    }
    return lines.join("\n");
  }).join("\n\n");

  return `APPLICANT PROFILE:\n${profileLines}\n\nFORM QUESTIONS:\n${questionLines}\n\nNow return the JSON object with answers for all questions above.`;
}
