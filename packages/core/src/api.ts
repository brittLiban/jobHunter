import { z } from "zod";

import {
  dashboardSnapshotSchema,
  generatedAnswerSchema,
  jobPreferencesSchema,
  jobPostingSchema,
  jobSeniorityAssessmentSchema,
  structuredProfileSchema,
} from "./domain";

export const signupInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
});

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const onboardingInputSchema = z.object({
  profile: structuredProfileSchema,
  preferences: jobPreferencesSchema,
});

export const resumeUploadInputSchema = z.object({
  label: z.string().min(1),
  baseText: z.string().min(50),
  setAsDefault: z.boolean().default(false),
});

export const reopenApplicationInputSchema = z.object({
  applicationId: z.string().min(1),
});

export const jobsResponseSchema = z.object({
  jobs: z.array(jobPostingSchema.extend({
    applicationId: z.string().nullable(),
    fitScore: z.number().int().min(0).max(100).nullable(),
    status: z.string(),
    decision: z.enum(["apply", "skip"]).nullable(),
    blockingReason: z.string().nullable(),
    lastAutomationUrl: z.string().nullable(),
    preparedPayload: z.unknown().nullable(),
    applicationUpdatedAt: z.string().nullable(),
    preparedAt: z.string().nullable(),
    submittedAt: z.string().nullable(),
    needsUserActionAt: z.string().nullable(),
    simpleFlowConfirmed: z.boolean(),
    highConfidence: z.boolean(),
    seniorityAssessment: jobSeniorityAssessmentSchema.nullable().optional(),
  })),
});

export const applicationsResponseSchema = z.object({
  applications: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      title: z.string(),
      source: z.string(),
      sourceKind: z.string().optional(),
      location: z.string().optional(),
      workMode: z.string().nullable().optional(),
      seniority: z.string().nullable().optional(),
      seniorityConfidence: z.number().nullable().optional(),
      fitScore: z.number().int().min(0).max(100).nullable(),
      status: z.string(),
      blockingReason: z.string().nullable(),
      manualActionType: z.string().nullable(),
      jobUrl: z.string().url(),
      applyUrl: z.string().url(),
      lastAutomationUrl: z.string().nullable(),
      preparedPayload: z.unknown().nullable(),
      automationSession: z.unknown().nullable(),
      automationSummary: z.object({
        filledFieldCount: z.number().int().nonnegative(),
        unknownRequiredFields: z.array(z.string()),
        missingProfileFields: z.array(z.string()),
      }).optional(),
      simpleFlowConfirmed: z.boolean(),
      highConfidence: z.boolean(),
      preparedAt: z.string().nullable(),
      autoSubmittedAt: z.string().nullable(),
      submittedAt: z.string().nullable(),
      needsUserActionAt: z.string().nullable(),
      updatedAt: z.string(),
      generatedAnswers: z.array(generatedAnswerSchema),
      events: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          actor: z.string(),
          title: z.string(),
          detail: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
});

export const notificationsResponseSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      title: z.string(),
      body: z.string(),
      actionUrl: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const profileResponseSchema = z.object({
  onboardingComplete: z.boolean(),
  profile: structuredProfileSchema.partial(),
  preferences: jobPreferencesSchema.partial(),
  resumes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      originalFileName: z.string(),
      storageKey: z.string(),
      isDefault: z.boolean(),
      createdAt: z.string(),
      versions: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
});

export const dashboardResponseSchema = z.object({
  snapshot: dashboardSnapshotSchema,
});

export type SignupInput = z.infer<typeof signupInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type ResumeUploadInput = z.infer<typeof resumeUploadInputSchema>;
