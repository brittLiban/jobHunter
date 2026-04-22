import type {
  JobPreferences,
  JobPosting,
  StructuredProfile,
  WeightedBreakdown,
} from "./domain";
import type { JobSeniority } from "./status";

export type RuleEvaluation = {
  passed: boolean;
  reasons: string[];
  breakdown: WeightedBreakdown;
};

const GREATER_SEATTLE_TERMS = [
  "seattle",
  "bellevue",
  "redmond",
  "kirkland",
  "renton",
  "bothell",
  "issaquah",
  "shoreline",
  "everett",
  "tacoma",
];

const ENTRY_TERMS = [
  "new grad",
  "entry",
  "entry-level",
  "junior",
  "intern",
  "apprentice",
  "early career",
  "graduate",
  "associate",
];

const MID_TERMS = [
  "mid",
  "mid-level",
  "intermediate",
  "ii",
  "level 2",
  "2+ years",
  "3+ years",
  "4+ years",
];

const SENIOR_TERMS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "architect",
  "5+ years",
  "6+ years",
  "7+ years",
  "8+ years",
  "10+ years",
];

const TITLE_ENTRY_PATTERNS = [
  /\bintern\b/,
  /\bnew grad\b/,
  /\bentry(?:-level)?\b/,
  /\bjunior\b/,
  /\bgraduate\b/,
  /\bapprentice\b/,
  /\bassociate\b/,
];

const TITLE_MID_PATTERNS = [
  /\bmid(?:-level)?\b/,
  /\bintermediate\b/,
  /\bii\b/,
  /\bl2\b/,
  /\blevel\s*2\b/,
  /\bengineer\s*2\b/,
];

const TITLE_SENIOR_PATTERNS = [
  /\bsenior\b/,
  /\bstaff\b/,
  /\bprincipal\b/,
  /\blead\b/,
  /\bmanager\b/,
  /\bdirector\b/,
  /\barchitect\b/,
];

export function evaluateJobRules(input: {
  job: JobPosting;
  preferences: JobPreferences;
  profile: StructuredProfile;
  resumeText: string;
}): RuleEvaluation {
  const { job, preferences, profile, resumeText } = input;
  const discovery = evaluateDiscoveryControls({
    job,
    preferences,
    profile,
  });
  const reasons = [...discovery.reasons];

  if (preferences.salaryFloor && job.salaryMax && job.salaryMax < preferences.salaryFloor) {
    reasons.push("Salary range is below the configured floor.");
  }

  const locationAndAuthorizationFit =
    discovery.locationMatch && profile.workAuthorization.toLowerCase().includes("authorized") ? 100 : 40;
  const skillOverlap = computeSignalScore(
    `${job.description} ${resumeText}`,
    ["typescript", "python", "api", "automation", "integration", "testing"],
  );
  const techStackOverlap = computeSignalScore(
    `${job.description} ${resumeText}`,
    ["postgres", "docker", "cloud", "react", "node", "playwright"],
  );
  const roleAlignment = discovery.titleMatch ? 90 : 45;
  const experienceLevelMatch = computeExperienceScore(discovery.seniority, profile.yearsOfExperience);

  return {
    passed: reasons.length === 0,
    reasons,
    breakdown: {
      skillOverlap,
      techStackOverlap,
      roleAlignment,
      experienceLevelMatch,
      locationAndAuthorizationFit,
    },
  };
}

export function evaluateDiscoveryControls(input: {
  job: JobPosting;
  preferences: JobPreferences;
  profile: StructuredProfile;
}) {
  const { job, preferences, profile } = input;
  const reasons: string[] = [];
  const titleMatch = matchesTargetRoles(job.title, preferences.targetRoles);
  const locationMatch = matchesLocationPreferences(job.location, preferences.locations, profile.country);
  const workModeMatch = matchesWorkMode(job.workMode, preferences.workModes);
  const seniority = job.seniority ?? inferJobSeniorityFromText(job.title, job.description).level;
  const seniorityMatch = preferences.seniorityTargets.includes(seniority);
  const keywordMatch = matchesKeywordControls(job, preferences.includeKeywords, preferences.excludeKeywords);
  const sourceMatch = preferences.sourceKinds.includes(job.sourceKind);

  if (!titleMatch) {
    reasons.push("Role title does not match target roles.");
  }
  if (!locationMatch) {
    reasons.push("Location does not match preferred locations.");
  }
  if (!workModeMatch) {
    reasons.push("Work mode does not match preferences.");
  }
  if (!seniorityMatch) {
    reasons.push(`Role seniority was classified as ${seniority}, which is outside the configured target levels.`);
  }
  if (!keywordMatch.passed) {
    reasons.push(...keywordMatch.reasons);
  }
  if (!sourceMatch) {
    reasons.push("Source is disabled for this user.");
  }

  return {
    passed: reasons.length === 0,
    reasons,
    titleMatch,
    locationMatch,
    workModeMatch,
    seniorityMatch,
    sourceMatch,
    seniority,
  };
}

export function inferJobSeniorityFromText(title: string, description: string): {
  level: JobSeniority;
  confidence: number;
  reasoning: string;
} {
  const normalizedTitle = title.toLowerCase();
  const normalizedDescription = description.toLowerCase();
  const haystack = `${normalizedTitle}\n${normalizedDescription}`;

  if (matchesAnyPattern(normalizedTitle, TITLE_ENTRY_PATTERNS)) {
    return {
      level: "entry",
      confidence: 0.96,
      reasoning: "The job title contains explicit entry-level markers such as intern, new grad, junior, or entry-level.",
    };
  }

  if (matchesAnyPattern(normalizedTitle, TITLE_MID_PATTERNS)) {
    return {
      level: "mid",
      confidence: 0.88,
      reasoning: "The job title contains explicit mid-level markers such as II, L2, engineer 2, or mid-level.",
    };
  }

  if (matchesAnyPattern(normalizedTitle, TITLE_SENIOR_PATTERNS)) {
    return {
      level: "senior",
      confidence: 0.95,
      reasoning: "The job title contains explicit senior-level markers such as senior, staff, principal, lead, or manager.",
    };
  }

  const experienceRequirement = extractMinimumYearsRequirement(haystack);
  if (experienceRequirement !== null) {
    if (experienceRequirement <= 2) {
      return {
        level: "entry",
        confidence: 0.78,
        reasoning: "The posting asks for at most two years of experience, which is treated as entry-level scope.",
      };
    }

    if (experienceRequirement <= 5) {
      return {
        level: "mid",
        confidence: 0.8,
        reasoning: "The posting asks for roughly three to five years of experience, which is treated as mid-level scope.",
      };
    }

    return {
      level: "senior",
      confidence: 0.86,
      reasoning: "The posting asks for six or more years of experience, which is treated as senior-level scope.",
    };
  }

  if (containsAny(haystack, ENTRY_TERMS)) {
    return {
      level: "entry",
      confidence: 0.84,
      reasoning: "The posting includes entry-level markers such as new grad, junior, intern, or associate.",
    };
  }

  if (containsAny(haystack, MID_TERMS)) {
    return {
      level: "mid",
      confidence: 0.72,
      reasoning: "The posting includes intermediate signals such as mid-level, level II, or moderate experience requirements.",
    };
  }

  if (containsAny(haystack, SENIOR_TERMS)) {
    return {
      level: "senior",
      confidence: 0.7,
      reasoning: "The posting includes senior-level language in the description even though the title is generic.",
    };
  }

  return {
    level: "mid",
    confidence: 0.58,
    reasoning: "No strong entry-level or senior-level signals were found, so the role is treated as mid-level by default.",
  };
}

function computeSignalScore(haystack: string, terms: string[]): number {
  const normalized = haystack.toLowerCase();
  const hits = terms.filter((term) => normalized.includes(term)).length;
  return Math.min(100, 35 + hits * 11);
}

function computeExperienceScore(seniority: JobSeniority, yearsOfExperience: number): number {
  switch (seniority) {
    case "entry":
      return yearsOfExperience <= 3 ? 95 : 72;
    case "senior":
      return yearsOfExperience >= 5 ? 88 : 32;
    case "mid":
    default:
      return yearsOfExperience >= 2 && yearsOfExperience <= 6 ? 85 : 58;
  }
}

function matchesTargetRoles(title: string, targetRoles: string[]) {
  const normalizedTitle = title.toLowerCase();
  return targetRoles.some((role) => normalizedTitle.includes(role.toLowerCase()));
}

function matchesLocationPreferences(jobLocation: string, locations: string[], country: string) {
  const normalizedLocation = jobLocation.toLowerCase();

  return locations.some((location) => {
    const normalizedPreference = location.toLowerCase();
    if (!normalizedPreference) {
      return false;
    }

    if (normalizedPreference.includes("remote")) {
      return normalizedLocation.includes("remote") && matchesCountryScope(normalizedLocation, country);
    }

    if (isGreaterSeattlePreference(normalizedPreference)) {
      return GREATER_SEATTLE_TERMS.some((term) => normalizedLocation.includes(term));
    }

    return normalizedLocation.includes(normalizedPreference);
  });
}

function matchesWorkMode(jobWorkMode: JobPosting["workMode"], preferredWorkModes: JobPreferences["workModes"]) {
  return !jobWorkMode || preferredWorkModes.includes(jobWorkMode) || preferredWorkModes.includes("flexible");
}

function matchesKeywordControls(job: JobPosting, includeKeywords: string[], excludeKeywords: string[]) {
  const haystack = `${job.company}\n${job.title}\n${job.location}\n${job.description}`.toLowerCase();
  const includeTerms = includeKeywords.map((term) => term.trim().toLowerCase()).filter(Boolean);
  const excludeTerms = excludeKeywords.map((term) => term.trim().toLowerCase()).filter(Boolean);
  const reasons: string[] = [];

  if (includeTerms.length > 0 && !includeTerms.some((term) => haystack.includes(term))) {
    reasons.push("Job did not match any required include keyword.");
  }

  const excluded = excludeTerms.find((term) => haystack.includes(term));
  if (excluded) {
    reasons.push(`Job matched excluded keyword "${excluded}".`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

function matchesCountryScope(location: string, country: string) {
  const normalizedCountry = country.toLowerCase();
  if (!normalizedCountry.includes("united states")) {
    return true;
  }

  if (containsAny(location, ["united states", "u.s.", "usa", "us-only", "within u.s.", "north america"])) {
    return true;
  }

  return !containsAny(location, [
    "ireland",
    "united kingdom",
    "uk",
    "london",
    "israel",
    "tel aviv",
    "dublin",
    "germany",
    "berlin",
    "france",
    "canada",
    "toronto",
    "australia",
    "india",
    "singapore",
    "emea",
    "europe",
  ]);
}

function isGreaterSeattlePreference(value: string) {
  return value.includes("seattle") || value.includes("bellevue") || value.includes("greater seattle");
}

function containsAny(haystack: string, terms: readonly string[]) {
  return terms.some((term) => haystack.includes(term));
}

function matchesAnyPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function extractMinimumYearsRequirement(value: string) {
  const matches = [...value.matchAll(/(\d+)\s*\+?\s*(?:years|year|yrs|yr)/g)];
  if (matches.length === 0) {
    return null;
  }

  const values = matches
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((item) => Number.isFinite(item));

  if (values.length === 0) {
    return null;
  }

  return Math.min(...values);
}
