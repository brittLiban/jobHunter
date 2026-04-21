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

export function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveStructuredValue(
  label: string,
  defaults: StructuredApplicationDefaults,
  generatedAnswers: GeneratedAnswer[],
): { value: string | null; missingField: string | null; source: string } {
  const normalized = normalizeLabel(label);
  const matches = Object.entries(labelAliases).find(([, aliases]) =>
    aliases.some((alias) => normalized.includes(normalizeLabel(alias))),
  );

  if (matches) {
    const [key] = matches as [keyof StructuredApplicationDefaults, string[]];
    const raw = defaults[key];
    if (Array.isArray(raw)) {
      return {
        value: raw.join(", "),
        missingField: raw.length === 0 ? key : null,
        source: "structured_profile",
      };
    }
    if (typeof raw === "string" && raw.trim()) {
      return {
        value: raw,
        missingField: null,
        source: "structured_profile",
      };
    }
    return {
      value: null,
      missingField: key,
      source: "structured_profile",
    };
  }

  if (isOpenTextPrompt(normalized)) {
    const answer = resolveOpenTextAnswer(normalized, defaults, generatedAnswers);
    if (answer) {
      return {
        value: answer,
        missingField: null,
        source: "generated_material",
      };
    }
  }

  return {
    value: null,
    missingField: null,
    source: "unknown",
  };
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
