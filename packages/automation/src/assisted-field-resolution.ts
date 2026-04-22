import type { GeneratedAnswer, StructuredApplicationDefaults } from "@jobhunter/core";

import { ApplicationFieldResolverService } from "@jobhunter/llm";

import {
  inferFieldResolutionStrategy,
  resolveStructuredValueByStrategy,
  type FieldResolutionResult,
  type FieldResolutionStrategy,
} from "./field-mapping";
import { findSemanticResolution, recordSemanticResolution } from "./semantic-cache";

export async function resolveStructuredValueWithAssistance(input: {
  sourceHost: string;
  label: string;
  defaults: StructuredApplicationDefaults;
  generatedAnswers: GeneratedAnswer[];
  llmResolver?: ApplicationFieldResolverService;
}): Promise<FieldResolutionResult> {
  const heuristicStrategy = inferFieldResolutionStrategy(input.label);
  const heuristicResult = resolveStructuredValueByStrategy(
    heuristicStrategy,
    input.defaults,
    input.generatedAnswers,
  );

  if (heuristicResult.value || heuristicStrategy.kind !== "none") {
    if (heuristicStrategy.kind !== "none") {
      await recordSemanticResolution({
        sourceHost: input.sourceHost,
        label: input.label,
        strategy: heuristicStrategy,
        resolutionSource: "heuristic",
      });
    }
    return heuristicResult;
  }

  const cached = await findSemanticResolution({
    sourceHost: input.sourceHost,
    label: input.label,
  });
  if (cached) {
    const cachedResult = resolveStructuredValueByStrategy(
      cached.strategy,
      input.defaults,
      input.generatedAnswers,
    );
    if (cachedResult.value || cached.strategy.kind === "none") {
      return {
        ...cachedResult,
        source: cached.strategy.kind === "none" ? "semantic_cache_none" : "semantic_cache",
      };
    }
  }

  const llmResolver = input.llmResolver ?? new ApplicationFieldResolverService();
  const llmResolution = await llmResolver.resolve({
    sourceHost: input.sourceHost,
    fieldLabel: input.label,
    defaults: input.defaults,
    generatedAnswers: input.generatedAnswers,
  });

  const llmStrategy = toFieldResolutionStrategy(llmResolution);
  await recordSemanticResolution({
    sourceHost: input.sourceHost,
    label: input.label,
    strategy: llmStrategy,
    resolutionSource: "llm",
  });

  const llmResult = resolveStructuredValueByStrategy(
    llmStrategy,
    input.defaults,
    input.generatedAnswers,
  );

  return {
    ...llmResult,
    source: llmStrategy.kind === "none" ? "llm_none" : "llm",
  };
}

function toFieldResolutionStrategy(value: Awaited<ReturnType<ApplicationFieldResolverService["resolve"]>>): FieldResolutionStrategy {
  switch (value.kind) {
    case "structured_field":
      return {
        kind: "structured_field",
        key: value.target,
      };
    case "generated_answer":
      return {
        kind: "generated_answer",
        answerKind: value.target,
      };
    case "tailored_summary":
      return {
        kind: "tailored_summary",
      };
    case "none":
    default:
      return { kind: "none" };
  }
}
