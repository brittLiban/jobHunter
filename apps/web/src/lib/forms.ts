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
    school: getString(formData, "school"),
    degree: getString(formData, "degree"),
    graduationDate: getString(formData, "graduationDate"),
    yearsOfExperience: Number(getString(formData, "yearsOfExperience")),
    currentCompany: getString(formData, "currentCompany"),
    currentTitle: getString(formData, "currentTitle"),
  };
}

export function preferencesFromFormData(formData: FormData): JobPreferences {
  return {
    targetRoles: splitList(getString(formData, "targetRoles")),
    locations: splitList(getString(formData, "locations")),
    workModes: splitList(getString(formData, "workModes")) as JobPreferences["workModes"],
    salaryFloor: getOptionalNumber(formData, "salaryFloor"),
    fitThreshold: Number(getString(formData, "fitThreshold")),
    dailyTargetVolume: Number(getString(formData, "dailyTargetVolume")),
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
