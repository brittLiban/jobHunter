import { z } from "zod";

import {
  answerKindSchema,
  applicationStatusSchema,
  jobSenioritySchema,
  jobSourceKindSchema,
  manualActionTypeSchema,
  notificationTypeSchema,
  promptTaskKindSchema,
  workModeSchema,
} from "./status";

export const structuredProfileFields = [
  "fullLegalName",
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
  "gender",
  "ethnicity",
  "school",
  "degree",
  "graduationDate",
  "yearsOfExperience",
  "currentCompany",
  "currentTitle",
] as const;

export const structuredProfileSchema = z.object({
  fullLegalName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  linkedinUrl: z.string().url().optional(),
  githubUrl: z.string().url().optional(),
  portfolioUrl: z.string().url().optional(),
  workAuthorization: z.string().min(1),
  usCitizenStatus: z.string().min(1),
  requiresVisaSponsorship: z.boolean(),
  veteranStatus: z.string().min(1),
  disabilityStatus: z.string().optional(),
  gender: z.string().optional(),       // EEO — "Male", "Female", "Non-binary", "Prefer not to say"
  ethnicity: z.string().optional(),    // EEO — "Hispanic or Latino", "Not Hispanic or Latino", "Prefer not to say"
  school: z.string().min(1),
  degree: z.string().min(1),
  graduationDate: z.string().min(1),
  yearsOfExperience: z.number().int().nonnegative(),
  currentCompany: z.string().min(1),
  currentTitle: z.string().min(1),
});

export const jobPreferencesSchema = z.object({
  targetRoles: z.array(z.string().min(1)).min(1),
  locations: z.array(z.string().min(1)).min(1),
  workModes: z.array(workModeSchema).min(1),
  seniorityTargets: z.array(jobSenioritySchema).min(1).default(["entry", "mid"]),
  salaryFloor: z.number().int().nonnegative().optional(),
  fitThreshold: z.number().int().min(0).max(100).default(70),
  dailyTargetVolume: z.number().int().min(1).max(100).default(15),
  includeKeywords: z.array(z.string().min(1)).default([]),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  sourceKinds: z.array(jobSourceKindSchema).min(1).default(["greenhouse", "ashby", "lever", "workable", "mock"]),
  // LLM engine settings (override environment variables when provided)
  llmProvider: z.enum(["anthropic", "openai", "ollama"]).optional(),
  llmModel: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmApiKey: z.string().optional(),
  // Per-user job board lists
  greenhouseBoards: z.array(z.string().min(1)).default([]),
  ashbyBoards: z.array(z.string().min(1)).default([]),
  leverBoards: z.array(z.string().min(1)).default([]),
  workableBoards: z.array(z.string().min(1)).default([]),
  // Aggregator source config
  remoteokTags: z.array(z.string().min(1)).default([]),
  adzunaQueries: z.array(z.object({ keywords: z.string(), location: z.string().optional() })).default([]),
});

export const jobPostingSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  sourceKind: jobSourceKindSchema,
  sourceName: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  seniority: jobSenioritySchema.optional(),
  seniorityConfidence: z.number().min(0).max(1).optional(),
  workMode: workModeSchema.optional(),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  salaryCurrency: z.string().default("USD"),
  description: z.string(),
  url: z.string().url(),
  applyUrl: z.string().url().optional(),
  discoveredAt: z.string(),
});

export const weightedBreakdownSchema = z.object({
  skillOverlap: z.number().min(0).max(100),
  techStackOverlap: z.number().min(0).max(100),
  roleAlignment: z.number().min(0).max(100),
  experienceLevelMatch: z.number().min(0).max(100),
  locationAndAuthorizationFit: z.number().min(0).max(100),
});

export const fitAssessmentSchema = z.object({
  fitScore: z.number().int().min(0).max(100),
  decision: z.enum(["apply", "skip"]),
  confidence: z.number().min(0).max(1),
  topMatches: z.array(z.string().min(1)).max(5),
  majorGaps: z.array(z.string().min(1)).max(5),
  weightedBreakdown: weightedBreakdownSchema,
});

export const jobSeniorityAssessmentSchema = z.object({
  level: jobSenioritySchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export const tailoredResumeDraftSchema = z.object({
  summaryLine: z.string().min(1),
  tailoredBullets: z.array(z.string().min(1)).min(2).max(4),
  keywordHighlights: z.array(z.string().min(1)).max(12).default([]),
});

export const generatedAnswerSchema = z.object({
  kind: answerKindSchema,
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const generatedAnswerSetSchema = z.object({
  items: z.array(generatedAnswerSchema).max(12),
});

export const applicationCheckpointSchema = z.object({
  manualActionType: manualActionTypeSchema,
  reason: z.string().min(1),
  currentUrl: z.string().url().optional(),
  preparedFields: z.record(z.string(), z.string()).default({}),
});

export const applicationAutomationSummarySchema = z.object({
  filledFieldCount: z.number().int().nonnegative().default(0),
  unknownRequiredFields: z.array(z.string().min(1)).default([]),
  missingProfileFields: z.array(z.string().min(1)).default([]),
  suggestedFieldAnswers: z.record(z.string(), z.string()).default({}),
});

export const applicationRecordSchema = z.object({
  id: z.string(),
  company: z.string(),
  role: z.string(),
  source: z.string(),
  sourceKind: jobSourceKindSchema.optional(),
  location: z.string().default(""),
  workMode: workModeSchema.nullable().optional(),
  seniority: jobSenioritySchema.nullable().optional(),
  seniorityConfidence: z.number().min(0).max(1).nullable().optional(),
  fitScore: z.number().int().min(0).max(100),
  status: applicationStatusSchema,
  blockingReason: z.string().nullable().default(null),
  manualActionType: z.string().nullable().default(null),
  jobUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  lastAutomationUrl: z.string().nullable().default(null),
  preparedAt: z.string().nullable().default(null),
  submittedAt: z.string().nullable().default(null),
  needsUserActionAt: z.string().nullable().default(null),
  updatedAt: z.string(),
  generatedAnswersCount: z.number().int().nonnegative().default(0),
  automationSummary: applicationAutomationSummarySchema.optional(),
});

export const promptTemplateSchema = z.object({
  name: z.string().min(1),
  taskKind: promptTaskKindSchema,
  systemPrompt: z.string().min(1),
  userPrompt: z.string().min(1),
});

export const notificationSchema = z.object({
  id: z.string().min(1),
  type: notificationTypeSchema,
  title: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string(),
});

export const dashboardSnapshotSchema = z.object({
  overview: z.object({
    jobsFound: z.number().int().nonnegative(),
    aboveThreshold: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    prepared: z.number().int().nonnegative(),
    autoSubmitted: z.number().int().nonnegative(),
    submittedTotal: z.number().int().nonnegative(),
    needsUserAction: z.number().int().nonnegative(),
    dailyTargetVolume: z.number().int().positive(),
    preparedInLast24Hours: z.number().int().nonnegative(),
    remainingDailyCapacity: z.number().int().nonnegative(),
  }),
  applications: z.array(applicationRecordSchema),
  notifications: z.array(notificationSchema),
});

export type StructuredProfile = z.infer<typeof structuredProfileSchema>;
export type JobPreferences = z.infer<typeof jobPreferencesSchema>;
export type JobPosting = z.infer<typeof jobPostingSchema>;
export type WeightedBreakdown = z.infer<typeof weightedBreakdownSchema>;
export type FitAssessment = z.infer<typeof fitAssessmentSchema>;
export type JobSeniorityAssessment = z.infer<typeof jobSeniorityAssessmentSchema>;
export type TailoredResumeDraft = z.infer<typeof tailoredResumeDraftSchema>;
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;
export type GeneratedAnswerSet = z.infer<typeof generatedAnswerSetSchema>;
export type ApplicationCheckpoint = z.infer<typeof applicationCheckpointSchema>;
export type ApplicationAutomationSummary = z.infer<typeof applicationAutomationSummarySchema>;
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;

export function meetsFitThreshold(score: number, threshold = 70): boolean {
  return score >= threshold;
}

export function shouldAutoSubmit(options: {
  confidence: number;
  simpleAndPredictableFlow: boolean;
  checkpoint: ApplicationCheckpoint | null;
}): boolean {
  const { confidence, simpleAndPredictableFlow, checkpoint } = options;
  return simpleAndPredictableFlow && confidence >= 0.8 && checkpoint === null;
}
