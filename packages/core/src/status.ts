import { z } from "zod";

export const applicationStatuses = [
  "discovered",
  "scored",
  "skipped",
  "queued",
  "prepared",
  "auto_submitted",
  "needs_user_action",
  "submitted",
  "responded",
  "interview",
  "rejected",
  "offer",
] as const;

export const manualActionTypes = [
  "captcha",
  "email_verification_code",
  "security_verification",
  "upload_failure",
  "unknown_form_structure",
  "missing_required_info",
  "ambiguous_submit_state",
] as const;

export const jobSourceKinds = [
  "mock",
  "greenhouse",
  "ashby",
  "lever",
  "workable",
  "company_site",
  "extension",
] as const;

export const jobSeniorityLevels = ["entry", "mid", "senior"] as const;

export const workModes = ["remote", "hybrid", "on_site", "flexible"] as const;

export const answerKinds = [
  "why_role",
  "why_fit",
  "anything_else",
  "custom",
] as const;

export const promptTaskKinds = [
  "job_scorer",
  "resume_tailor",
  "short_answer_generator",
] as const;

export const notificationTypes = [
  "info",
  "success",
  "warning",
  "error",
  "action_required",
] as const;

export const applicationStatusSchema = z.enum(applicationStatuses);
export const manualActionTypeSchema = z.enum(manualActionTypes);
export const jobSourceKindSchema = z.enum(jobSourceKinds);
export const jobSenioritySchema = z.enum(jobSeniorityLevels);
export const workModeSchema = z.enum(workModes);
export const answerKindSchema = z.enum(answerKinds);
export const promptTaskKindSchema = z.enum(promptTaskKinds);
export const notificationTypeSchema = z.enum(notificationTypes);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type ManualActionType = z.infer<typeof manualActionTypeSchema>;
export type JobSourceKind = z.infer<typeof jobSourceKindSchema>;
export type JobSeniority = z.infer<typeof jobSenioritySchema>;
export type WorkMode = z.infer<typeof workModeSchema>;
export type AnswerKind = z.infer<typeof answerKindSchema>;
export type PromptTaskKind = z.infer<typeof promptTaskKindSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
