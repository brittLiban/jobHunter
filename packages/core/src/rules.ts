import type {
  JobPreferences,
  JobPosting,
  StructuredProfile,
  WeightedBreakdown,
} from "./domain";

export type RuleEvaluation = {
  passed: boolean;
  reasons: string[];
  breakdown: WeightedBreakdown;
};

export function evaluateJobRules(input: {
  job: JobPosting;
  preferences: JobPreferences;
  profile: StructuredProfile;
  resumeText: string;
}): RuleEvaluation {
  const { job, preferences, profile, resumeText } = input;
  const reasons: string[] = [];

  const titleMatch = preferences.targetRoles.some((role) =>
    job.title.toLowerCase().includes(role.toLowerCase()),
  );
  if (!titleMatch) {
    reasons.push("Role title does not match target roles.");
  }

  const locationMatch =
    preferences.locations.some((location) =>
      job.location.toLowerCase().includes(location.toLowerCase()),
    ) ||
    preferences.locations.some((location) => location.toLowerCase() === "remote") ||
    job.location.toLowerCase().includes("remote");
  if (!locationMatch) {
    reasons.push("Location does not match preferred locations.");
  }

  const workModeMatch =
    !job.workMode ||
    preferences.workModes.includes(job.workMode) ||
    preferences.workModes.includes("flexible");
  if (!workModeMatch) {
    reasons.push("Work mode does not match preferences.");
  }

  if (preferences.salaryFloor && job.salaryMax && job.salaryMax < preferences.salaryFloor) {
    reasons.push("Salary range is below the configured floor.");
  }

  const locationAndAuthorizationFit =
    locationMatch && profile.workAuthorization.toLowerCase().includes("authorized") ? 100 : 40;
  const skillOverlap = computeSignalScore(
    `${job.description} ${resumeText}`,
    ["typescript", "python", "api", "automation", "integration", "testing"],
  );
  const techStackOverlap = computeSignalScore(
    `${job.description} ${resumeText}`,
    ["postgres", "docker", "cloud", "react", "node", "playwright"],
  );
  const roleAlignment = titleMatch ? 90 : 45;
  const experienceLevelMatch = computeExperienceScore(job.description, profile.yearsOfExperience);

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

function computeSignalScore(haystack: string, terms: string[]): number {
  const normalized = haystack.toLowerCase();
  const hits = terms.filter((term) => normalized.includes(term)).length;
  return Math.min(100, 35 + hits * 11);
}

function computeExperienceScore(description: string, yearsOfExperience: number): number {
  const normalized = description.toLowerCase();
  if (normalized.includes("senior") || normalized.includes("staff")) {
    return yearsOfExperience >= 5 ? 80 : 35;
  }
  if (normalized.includes("new grad") || normalized.includes("entry")) {
    return yearsOfExperience <= 3 ? 95 : 75;
  }
  return yearsOfExperience >= 2 ? 85 : 60;
}
