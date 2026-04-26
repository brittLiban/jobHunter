import type { JobPreferences, StructuredProfile } from "@jobhunter/core";

export function profileFromFormData(formData: FormData): StructuredProfile {
  return {
    fullLegalName: getString(formData, "fullLegalName"),
    email: getString(formData, "email"),
    phone: getString(formData, "phone"),
    city: getString(formData, "city"),
    state: getString(formData, "state"),
    country: getString(formData, "country"),
    linkedinUrl: getOptionalString(formData, "linkedinUrl"),
    githubUrl: getOptionalString(formData, "githubUrl"),
    portfolioUrl: getOptionalString(formData, "portfolioUrl"),
    workAuthorization: getString(formData, "workAuthorization"),
    usCitizenStatus: getString(formData, "usCitizenStatus"),
    requiresVisaSponsorship: getString(formData, "requiresVisaSponsorship").toLowerCase() === "true",
    veteranStatus: getString(formData, "veteranStatus"),
    disabilityStatus: getOptionalString(formData, "disabilityStatus"),
    gender: getOptionalString(formData, "gender"),
    ethnicity: getOptionalString(formData, "ethnicity"),
    school: getString(formData, "school"),
    degree: getString(formData, "degree"),
    graduationDate: getString(formData, "graduationDate"),
    yearsOfExperience: Number(getString(formData, "yearsOfExperience")),
    currentCompany: getString(formData, "currentCompany"),
    currentTitle: getString(formData, "currentTitle"),
  };
}

export function preferencesFromFormData(formData: FormData): JobPreferences {
  const workModes = getMultiValueList(formData, "workModes");
  const seniorityTargets = getMultiValueList(formData, "seniorityTargets");
  const sourceKinds = getMultiValueList(formData, "sourceKinds");
  const llmProvider = getOptionalString(formData, "llmProvider");

  return {
    targetRoles: splitList(getString(formData, "targetRoles")),
    locations: splitList(getString(formData, "locations")),
    workModes: (workModes.length > 0 ? workModes : splitList(getString(formData, "workModes"))) as JobPreferences["workModes"],
    seniorityTargets: (seniorityTargets.length > 0 ? seniorityTargets : ["entry", "mid"]) as JobPreferences["seniorityTargets"],
    salaryFloor: getOptionalNumber(formData, "salaryFloor"),
    fitThreshold: Number(getString(formData, "fitThreshold")),
    dailyTargetVolume: Number(getString(formData, "dailyTargetVolume")),
    includeKeywords: splitList(getString(formData, "includeKeywords")),
    excludeKeywords: splitList(getString(formData, "excludeKeywords")),
    sourceKinds: (sourceKinds.length > 0 ? sourceKinds : ["greenhouse", "ashby", "lever", "workable", "remoteok", "adzuna", "mock"]) as JobPreferences["sourceKinds"],
    llmProvider: (llmProvider as JobPreferences["llmProvider"]) ?? undefined,
    llmModel: getOptionalString(formData, "llmModel"),
    llmBaseUrl: getOptionalString(formData, "llmBaseUrl"),
    llmApiKey: getOptionalString(formData, "llmApiKey"),
    greenhouseBoards: splitList(getString(formData, "greenhouseBoards")),
    ashbyBoards: splitList(getString(formData, "ashbyBoards")),
    leverBoards: splitList(getString(formData, "leverBoards")),
    workableBoards: splitList(getString(formData, "workableBoards")),
    remoteokTags: splitList(getString(formData, "remoteokTags")),
    adzunaQueries: parseAdzunaQueries(getString(formData, "adzunaQueriesRaw")),
  };
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key);
  return value || undefined;
}

function getOptionalNumber(formData: FormData, key: string) {
  const value = getString(formData, key);
  if (!value) {
    return undefined;
  }
  return Number(value);
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getMultiValueList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseAdzunaQueries(raw: string): Array<{ keywords: string; location?: string }> {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kw, loc] = line.split(":").map((p) => p.trim());
      return loc ? { keywords: kw, location: loc } : { keywords: kw };
    });
}
