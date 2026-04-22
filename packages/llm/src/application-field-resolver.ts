import type {
  GeneratedAnswer,
  StructuredApplicationDefaults,
} from "@jobhunter/core";

import { buildApplicationFieldResolverPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, type LLMProvider } from "./provider";

type StructuredFieldKey = keyof StructuredApplicationDefaults;
type GeneratedAnswerKind = GeneratedAnswer["kind"];

export type LLMFieldResolution =
  | {
    kind: "structured_field";
    target: StructuredFieldKey;
    confidence: number;
    reasoning: string;
  }
  | {
    kind: "generated_answer";
    target: GeneratedAnswerKind;
    confidence: number;
    reasoning: string;
  }
  | {
    kind: "tailored_summary";
    target: "tailoredSummary";
    confidence: number;
    reasoning: string;
  }
  | {
    kind: "none";
    target: "none";
    confidence: number;
    reasoning: string;
  };

const structuredFieldTargets = new Set<StructuredFieldKey>([
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
]);

const generatedAnswerTargets = new Set<GeneratedAnswerKind>([
  "why_role",
  "why_fit",
  "anything_else",
  "custom",
]);

export class ApplicationFieldResolverService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

  async resolve(input: {
    sourceHost: string;
    fieldLabel: string;
    defaults: StructuredApplicationDefaults;
    generatedAnswers: GeneratedAnswer[];
  }): Promise<LLMFieldResolution> {
    const fallback: LLMFieldResolution = {
      kind: "none",
      target: "none",
      confidence: 0,
      reasoning: "No reliable mapping found.",
    };

    const result = await this.llm.generateObject({
      ...buildApplicationFieldResolverPrompt(input),
      fallback,
    });

    return normalizeLLMFieldResolution(result) ?? fallback;
  }
}

function normalizeLLMFieldResolution(value: unknown): LLMFieldResolution | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = typeof value.kind === "string" ? value.kind : "";
  const target = typeof value.target === "string" ? value.target : "none";
  const confidence = typeof value.confidence === "number" ? value.confidence : 0;
  const reasoning = typeof value.reasoning === "string" ? value.reasoning : "No reasoning provided.";

  if (kind === "structured_field" && structuredFieldTargets.has(target as StructuredFieldKey)) {
    return {
      kind,
      target: target as StructuredFieldKey,
      confidence,
      reasoning,
    };
  }

  if (kind === "generated_answer" && generatedAnswerTargets.has(target as GeneratedAnswerKind)) {
    return {
      kind,
      target: target as GeneratedAnswerKind,
      confidence,
      reasoning,
    };
  }

  if (kind === "tailored_summary" && target === "tailoredSummary") {
    return {
      kind,
      target: "tailoredSummary",
      confidence,
      reasoning,
    };
  }

  if (kind === "none" || target === "none") {
    return {
      kind: "none",
      target: "none",
      confidence,
      reasoning,
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
