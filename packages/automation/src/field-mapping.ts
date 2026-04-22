import type {
  GeneratedAnswer,
  ManualActionType,
  StructuredApplicationDefaults,
} from "@jobhunter/core";

const labelAliases: Record<keyof StructuredApplicationDefaults, string[]> = {
  fullLegalName: ["full legal name"],
  firstName: ["first name", "legal first name", "given name"],
  lastName: ["last name", "family name", "surname"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile number"],
  city: ["city", "current city", "location city"],
  state: ["state", "province", "region"],
  country: ["country", "country of residence", "country where you currently reside"],
  linkedinUrl: ["linkedin", "linkedin profile"],
  githubUrl: ["github", "github profile"],
  portfolioUrl: ["portfolio", "personal website", "website"],
  workAuthorization: ["work authorization", "authorized to work", "legally authorized to work"],
  usCitizenStatus: ["citizen status", "u s citizen", "us citizen"],
  requiresVisaSponsorship: ["sponsorship", "visa sponsorship", "require sponsorship", "immigration support"],
  veteranStatus: ["veteran status", "veteran"],
  disabilityStatus: ["disability status", "disability"],
  school: ["school", "college", "university", "most recent school you attended"],
  degree: ["degree", "most recent degree you obtained"],
  graduationDate: ["graduation", "graduation date", "graduation year", "expected graduation date"],
  yearsOfExperience: ["years of experience", "experience"],
  currentCompany: ["current company", "current employer", "current or previous employer"],
  currentTitle: ["current title", "job title", "current or previous job title"],
  targetLocations: ["location preference", "preferred location"],
  workModes: ["remote", "hybrid", "on site", "on-site"],
  whyRole: ["why this role", "why are you interested", "why do you want", "why this company"],
  whyFit: ["why are you a fit", "good fit", "why should we hire you", "tell us about you and why"],
  anythingElse: ["anything else", "additional information"],
  tailoredSummary: ["summary", "cover letter"],
};

const manualActionBySignal: Array<{ type: ManualActionType; fragments: string[] }> = [
  {
    type: "captcha",
    fragments: ["captcha", "recaptcha", "turnstile", "hcaptcha", "arkose"],
  },
  {
    type: "email_verification_code",
    fragments: ["confirmation code", "verification code", "check your email", "one-time code"],
  },
  {
    type: "security_verification",
    fragments: ["verify your identity", "two factor", "2fa", "additional verification"],
  },
  {
    type: "upload_failure",
    fragments: ["upload failed", "try uploading again"],
  },
];

export type FieldResolutionStrategy =
  | { kind: "structured_field"; key: keyof StructuredApplicationDefaults }
  | { kind: "generated_answer"; answerKind: GeneratedAnswer["kind"] }
  | { kind: "tailored_summary" }
  | { kind: "none" };

export type FieldResolutionResult = {
  value: string | null;
  missingField: string | null;
  source: string;
  strategy: FieldResolutionStrategy;
};

export function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveStructuredValue(
  label: string,
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
): FieldResolutionResult {
  const strategy = inferFieldResolutionStrategy(label);
  return resolveStructuredValueByStrategy(strategy, defaults, generatedAnswers);
}

export function inferFieldResolutionStrategy(label: string): FieldResolutionStrategy {
  const normalized = normalizeLabel(label);
  const matches = Object.entries(labelAliases).find(([, aliases]) =>
    aliases.some((alias) => normalized.includes(normalizeLabel(alias))),
  );

  if (matches) {
    const [key] = matches as [keyof StructuredApplicationDefaults, string[]];
    return {
      kind: "structured_field",
      key,
    };
  }

  if (isOpenTextPrompt(normalized)) {
    if (normalized.includes("anything else")) {
      return {
        kind: "generated_answer",
        answerKind: "anything_else",
      };
    }
    if (normalized.includes("fit") || normalized.includes("hire")) {
      return {
        kind: "generated_answer",
        answerKind: "why_fit",
      };
    }
    if (normalized.includes("cover letter") || normalized.includes("summary")) {
      return { kind: "tailored_summary" };
    }
    return {
      kind: "generated_answer",
      answerKind: "why_role",
    };
  }

  return { kind: "none" };
}

export function resolveStructuredValueByStrategy(
  strategy: FieldResolutionStrategy,
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
): FieldResolutionResult {
  switch (strategy.kind) {
    case "structured_field": {
      const raw = defaults[strategy.key];
      if (Array.isArray(raw)) {
        return {
          value: raw.join(", "),
          missingField: raw.length === 0 ? strategy.key : null,
          source: "structured_profile",
          strategy,
        };
      }
      if (typeof raw === "string" && raw.trim()) {
        return {
          value: raw,
          missingField: null,
          source: "structured_profile",
          strategy,
        };
      }
      return {
        value: null,
        missingField: strategy.key,
        source: "structured_profile",
        strategy,
      };
    }
    case "generated_answer": {
      const answer = resolveGeneratedAnswer(strategy.answerKind, defaults, generatedAnswers);
      return {
        value: answer,
        missingField: answer ? null : strategy.answerKind,
        source: "generated_material",
        strategy,
      };
    }
    case "tailored_summary": {
      return {
        value: defaults.tailoredSummary?.trim() ? defaults.tailoredSummary : null,
        missingField: defaults.tailoredSummary?.trim() ? null : "tailoredSummary",
        source: "generated_material",
        strategy,
      };
    }
    case "none":
    default:
      return {
        value: null,
        missingField: null,
        source: "unknown",
        strategy: { kind: "none" },
      };
  }
}

export function detectManualActionType(pageText: string): ManualActionType | null {
  const normalized = normalizeLabel(pageText);
  const matched = manualActionBySignal.find(({ fragments }) =>
    fragments.some((fragment) => normalized.includes(normalizeLabel(fragment))),
  );
  return matched?.type ?? null;
}

export function isOpenTextPrompt(label: string): boolean {
  return [
    "why",
    "tell us",
    "additional information",
    "anything else",
    "good fit",
    "cover letter",
    "interested",
  ].some((fragment) => label.includes(fragment));
}

function resolveOpenTextAnswer(
  normalizedLabel: string,
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
) {
  if (normalizedLabel.includes("anything else")) {
    return defaults.anythingElse ?? generatedAnswers.find((item) => item.kind === "anything_else")?.answer ?? null;
  }
  if (normalizedLabel.includes("fit") || normalizedLabel.includes("hire")) {
    return defaults.whyFit ?? generatedAnswers.find((item) => item.kind === "why_fit")?.answer ?? null;
  }
  return defaults.whyRole ?? generatedAnswers.find((item) => item.kind === "why_role")?.answer ?? defaults.tailoredSummary ?? null;
}

function resolveGeneratedAnswer(
  answerKind: GeneratedAnswer["kind"],
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
) {
  switch (answerKind) {
    case "anything_else":
      return defaults.anythingElse ?? generatedAnswers.find((item) => item.kind === "anything_else")?.answer ?? null;
    case "why_fit":
      return defaults.whyFit ?? generatedAnswers.find((item) => item.kind === "why_fit")?.answer ?? null;
    case "why_role":
    default:
      return defaults.whyRole ?? generatedAnswers.find((item) => item.kind === "why_role")?.answer ?? defaults.tailoredSummary ?? null;
  }
}
