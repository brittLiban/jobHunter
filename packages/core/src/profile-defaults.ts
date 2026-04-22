import type {
  GeneratedAnswer,
  JobPreferences,
  StructuredProfile,
  TailoredResumeDraft,
} from "./domain";

export type StructuredApplicationDefaults = {
  fullLegalName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  workAuthorization: string;
  usCitizenStatus: string;
  requiresVisaSponsorship: "Yes" | "No";
  veteranStatus: string;
  disabilityStatus?: string;
  school: string;
  degree: string;
  graduationDate: string;
  yearsOfExperience: string;
  currentCompany: string;
  currentTitle: string;
  targetLocations: string[];
  workModes: string[];
  messagingOptIn?: "Yes" | "No";
  whyRole?: string;
  whyFit?: string;
  anythingElse?: string;
  tailoredSummary?: string;
};

export function buildStructuredApplicationDefaults(input: {
  profile: StructuredProfile;
  preferences: JobPreferences;
  tailoredResume?: TailoredResumeDraft | null;
  generatedAnswers?: GeneratedAnswer[];
}): StructuredApplicationDefaults {
  const { profile, preferences, tailoredResume, generatedAnswers = [] } = input;
  const [firstName = profile.fullLegalName, ...rest] = profile.fullLegalName.trim().split(/\s+/);
  const lastName = rest.join(" ");
  const answers = new Map(generatedAnswers.map((answer) => [answer.kind, answer.answer]));

  return {
    fullLegalName: profile.fullLegalName,
    firstName,
    lastName,
    email: profile.email,
    phone: profile.phone,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    workAuthorization: profile.workAuthorization,
    usCitizenStatus: profile.usCitizenStatus,
    requiresVisaSponsorship: profile.requiresVisaSponsorship ? "Yes" : "No",
    veteranStatus: profile.veteranStatus,
    disabilityStatus: profile.disabilityStatus,
    school: profile.school,
    degree: profile.degree,
    graduationDate: profile.graduationDate,
    yearsOfExperience: String(profile.yearsOfExperience),
    currentCompany: profile.currentCompany,
    currentTitle: profile.currentTitle,
    targetLocations: preferences.locations,
    workModes: preferences.workModes,
    messagingOptIn: "No",
    whyRole: answers.get("why_role"),
    whyFit: answers.get("why_fit"),
    anythingElse: answers.get("anything_else"),
    tailoredSummary: tailoredResume?.summaryLine,
  };
}
