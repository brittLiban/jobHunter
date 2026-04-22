import type { GeneratedAnswer, StructuredApplicationDefaults } from "@jobhunter/core";

import { buildApplicationFieldAnswerSuggestionPrompt } from "./prompt-templates";
import { createLLMProviderFromEnv, type LLMProvider } from "./provider";
import { findSemanticCacheValue, recordSemanticCacheValue } from "./semantic-cache";

export type ApplicationFieldAnswerSuggestion = {
  shouldSuggest: boolean;
  answer: string;
  confidence: number;
  reasoning: string;
};

export class ApplicationFieldAnswerSuggesterService {
  constructor(private readonly llm: LLMProvider = createLLMProviderFromEnv()) {}

  async suggest(input: {
    sourceHost: string;
    fieldLabel: string;
    defaults: StructuredApplicationDefaults;
    generatedAnswers: GeneratedAnswer[];
  }): Promise<ApplicationFieldAnswerSuggestion> {
    const fallback = heuristicSuggestion(input.fieldLabel, input.defaults);
    const cacheInput = {
      sourceHost: input.sourceHost,
      fieldLabel: input.fieldLabel,
      defaults: input.defaults,
      generatedAnswers: input.generatedAnswers,
    };

    const cached = await findSemanticCacheValue<ApplicationFieldAnswerSuggestion>(
      "application-field-answer-suggester",
      cacheInput,
    );
    if (cached) {
      return normalizeSuggestion(cached) ?? fallback;
    }

    const result = await this.llm.generateObject({
      ...buildApplicationFieldAnswerSuggestionPrompt(input),
      fallback,
    });

    const normalized = normalizeSuggestion(result) ?? fallback;
    await recordSemanticCacheValue("application-field-answer-suggester", cacheInput, normalized);
    return normalized;
  }
}

function heuristicSuggestion(label: string, defaults: StructuredApplicationDefaults): ApplicationFieldAnswerSuggestion {
  const normalized = normalizeLabel(label);

  if (normalized.includes("sponsor") || normalized.includes("visa")) {
    return {
      shouldSuggest: true,
      answer: defaults.requiresVisaSponsorship,
      confidence: 0.85,
      reasoning: "Mapped sponsorship wording to structured visa sponsorship field.",
    };
  }

  if (normalized.includes("authorized to work")) {
    return {
      shouldSuggest: true,
      answer: normalized.includes("yes no")
        ? inferYesNo(defaults.workAuthorization)
        : defaults.workAuthorization,
      confidence: 0.8,
      reasoning: "Mapped authorization wording to structured work authorization field.",
    };
  }

  if (normalized.includes("whatsapp") || normalized.includes("text message") || normalized.includes("opt in")) {
    return {
      shouldSuggest: true,
      answer: defaults.messagingOptIn ?? "No",
      confidence: 0.72,
      reasoning: "Mapped recruiting messaging opt-in wording to structured messaging preference.",
    };
  }

  return {
    shouldSuggest: false,
    answer: "",
    confidence: 0,
    reasoning: "No reliable suggestion from structured facts without guessing.",
  };
}

function normalizeSuggestion(value: unknown): ApplicationFieldAnswerSuggestion | null {
  if (!isRecord(value)) {
    return null;
  }

  const shouldSuggest = Boolean(value.shouldSuggest);
  const answer = typeof value.answer === "string" ? value.answer.trim() : "";
  const confidence = typeof value.confidence === "number"
    ? Math.max(0, Math.min(1, value.confidence))
    : 0;
  const reasoning = typeof value.reasoning === "string"
    ? value.reasoning
    : "No reasoning provided.";

  if (!shouldSuggest || !answer) {
    return {
      shouldSuggest: false,
      answer: "",
      confidence,
      reasoning,
    };
  }

  return {
    shouldSuggest: true,
    answer,
    confidence,
    reasoning,
  };
}

function inferYesNo(value: string) {
  const normalized = normalizeLabel(value);
  if (normalized.includes("not") || normalized.includes("no")) {
    return "No";
  }
  return "Yes";
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
