import type {
  ApplicationRecord,
  ApplicationStatus as CoreApplicationStatus,
  DashboardSnapshot,
  GeneratedAnswer,
  JobPosting,
  JobPreferences,
  Notification,
  StructuredProfile,
} from "@jobhunter/core";
import type {
  Application,
  ApplicationEvent,
  ApplicationStatus as PrismaApplicationStatus,
  Prisma,
  GeneratedAnswer as PrismaGeneratedAnswer,
  GeneratedAnswerKind,
  Job,
  JobScore,
  JobSource,
  Notification as PrismaNotification,
  NotificationType as PrismaNotificationType,
  Resume,
  ResumeVersion,
  TailoredDocument,
  User,
  UserPreference,
  UserProfile,
} from "@prisma/client";

const applicationStatusMap: Record<PrismaApplicationStatus, CoreApplicationStatus> = {
  DISCOVERED: "discovered",
  SCORED: "scored",
  SKIPPED: "skipped",
  QUEUED: "queued",
  PREPARED: "prepared",
  AUTO_SUBMITTED: "auto_submitted",
  NEEDS_USER_ACTION: "needs_user_action",
  SUBMITTED: "submitted",
  RESPONDED: "responded",
  INTERVIEW: "interview",
  REJECTED: "rejected",
  OFFER: "offer",
};

export function toCoreApplicationStatus(status: PrismaApplicationStatus): CoreApplicationStatus {
  return applicationStatusMap[status];
}

export function fromCoreApplicationStatus(status: CoreApplicationStatus): PrismaApplicationStatus {
  return Object.entries(applicationStatusMap).find(([, value]) => value === status)?.[0] as PrismaApplicationStatus;
}

export function serializeDashboardSnapshot(input: {
  applications: Array<
    Application & {
      job: Job & { source: JobSource };
      generatedAnswers: PrismaGeneratedAnswer[];
    }
  >;
  notifications: PrismaNotification[];
}): DashboardSnapshot {
  const { applications, notifications } = input;

  return {
    overview: {
      jobsFound: applications.length,
      aboveThreshold: applications.filter((application) => (application.fitScoreSnapshot ?? 0) >= application.fitThresholdSnapshot).length,
      queued: applications.filter((application) => application.status === "QUEUED").length,
      prepared: applications.filter((application) => application.status === "PREPARED").length,
      autoSubmitted: applications.filter((application) => application.status === "AUTO_SUBMITTED").length,
      submittedTotal: applications.filter((application) => ["AUTO_SUBMITTED", "SUBMITTED"].includes(application.status)).length,
      needsUserAction: applications.filter((application) => application.status === "NEEDS_USER_ACTION").length,
    },
    applications: applications.map((application) => serializeApplicationRecord(application)),
    notifications: notifications.map((notification) => serializeNotification(notification)),
  };
}

export function serializeApplicationRecord(
  application: Application & {
    job: Job & { source: JobSource };
    generatedAnswers?: PrismaGeneratedAnswer[];
  },
): ApplicationRecord {
  return {
    id: application.id,
    company: application.job.company,
    role: application.job.title,
    source: application.job.source.name,
    fitScore: application.fitScoreSnapshot ?? 0,
    status: toCoreApplicationStatus(application.status),
    blockingReason: application.blockingReason,
    manualActionType: application.manualActionType?.toLowerCase() ?? null,
    jobUrl: application.job.canonicalUrl,
    applyUrl: application.job.applyUrl ?? undefined,
    lastAutomationUrl: application.lastAutomationUrl,
    preparedAt: application.preparedAt?.toISOString() ?? null,
    submittedAt: application.submittedAt?.toISOString() ?? application.autoSubmittedAt?.toISOString() ?? null,
    needsUserActionAt: application.needsUserActionAt?.toISOString() ?? null,
    updatedAt: application.updatedAt.toISOString(),
    generatedAnswersCount: application.generatedAnswers?.length ?? 0,
  };
}

export function serializeNotification(notification: PrismaNotification): Notification {
  return {
    id: notification.id,
    type: notification.type.toLowerCase() as Notification["type"],
    title: notification.title,
    message: notification.body,
    createdAt: notification.createdAt.toISOString(),
  };
}

export function serializeJobPosting(input: {
  job: Job & { source: JobSource };
  score?: JobScore | null;
  application?: Application | null;
}): JobPosting & {
  fitScore: number | null;
  status: string;
  decision: "apply" | "skip" | null;
  blockingReason: string | null;
  lastAutomationUrl: string | null;
  preparedPayload: Prisma.JsonValue | null;
  applicationUpdatedAt: string | null;
  preparedAt: string | null;
  submittedAt: string | null;
  needsUserActionAt: string | null;
  simpleFlowConfirmed: boolean;
  highConfidence: boolean;
} {
  const { job, score, application } = input;
  return {
    id: job.id,
    externalId: job.externalId ?? undefined,
    sourceKind: job.source.kind.toLowerCase() as JobPosting["sourceKind"],
    sourceName: job.source.name,
    company: job.company,
    title: job.title,
    location: job.locationText ?? "",
    workMode: job.workMode ? (job.workMode.toLowerCase() as JobPosting["workMode"]) : undefined,
    salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined,
    salaryCurrency: job.salaryCurrency ?? "USD",
    description: job.descriptionText,
    url: job.canonicalUrl,
    applyUrl: job.applyUrl ?? undefined,
    discoveredAt: job.discoveredAt.toISOString(),
    fitScore: score?.fitScore ?? null,
    status: application?.status.toLowerCase() ?? "discovered",
    decision: score ? (score.decision ? "apply" : "skip") : null,
    blockingReason: application?.blockingReason ?? null,
    lastAutomationUrl: application?.lastAutomationUrl ?? null,
    preparedPayload: (application?.preparedPayload as Prisma.JsonValue | null | undefined) ?? null,
    applicationUpdatedAt: application?.updatedAt.toISOString() ?? null,
    preparedAt: application?.preparedAt?.toISOString() ?? null,
    submittedAt: application?.submittedAt?.toISOString() ?? application?.autoSubmittedAt?.toISOString() ?? null,
    needsUserActionAt: application?.needsUserActionAt?.toISOString() ?? null,
    simpleFlowConfirmed: application?.simpleFlowConfirmed ?? false,
    highConfidence: application?.highConfidence ?? false,
  };
}

export function serializeGeneratedAnswers(items: PrismaGeneratedAnswer[]): GeneratedAnswer[] {
  return items.map((item) => ({
    kind: serializeGeneratedAnswerKind(item.kind),
    question: item.questionText,
    answer: item.answerText,
  }));
}

export function serializeProfile(profile: UserProfile | null | undefined): Partial<StructuredProfile> {
  if (!profile) {
    return {};
  }

  return {
    fullLegalName: profile.fullLegalName ?? undefined,
    email: undefined,
    phone: profile.phone ?? undefined,
    city: profile.city ?? undefined,
    state: profile.state ?? undefined,
    country: profile.country ?? undefined,
    linkedinUrl: profile.linkedinUrl ?? undefined,
    githubUrl: profile.githubUrl ?? undefined,
    portfolioUrl: profile.portfolioUrl ?? undefined,
    workAuthorization: profile.workAuthorization ?? undefined,
    usCitizenStatus: profile.usCitizenStatus ?? undefined,
    requiresVisaSponsorship: profile.requiresVisaSponsorship ?? undefined,
    veteranStatus: profile.veteranStatus ?? undefined,
    disabilityStatus: profile.disabilityStatus ?? undefined,
    school: profile.school ?? undefined,
    degree: profile.degree ?? undefined,
    graduationDate: profile.graduationDate?.toISOString().slice(0, 10),
    yearsOfExperience: profile.yearsOfExperience ?? undefined,
    currentCompany: profile.currentCompany ?? undefined,
    currentTitle: profile.currentTitle ?? undefined,
  };
}

export function serializePreferences(preferences: UserPreference | null | undefined): Partial<JobPreferences> {
  if (!preferences) {
    return {};
  }

  return {
    targetRoles: preferences.targetRoles,
    locations: preferences.targetLocations,
    workModes: preferences.workModes.map((mode) => mode.toLowerCase()) as JobPreferences["workModes"],
    salaryFloor: preferences.salaryFloor ?? undefined,
    fitThreshold: preferences.fitThreshold,
    dailyTargetVolume: preferences.dailyTargetVolume,
  };
}

export function serializeResume(resume: Resume & { versions?: ResumeVersion[] }) {
  return {
    id: resume.id,
    label: resume.label,
    originalFileName: resume.originalFileName,
    storageKey: resume.storageKey,
    isDefault: resume.isDefault,
    createdAt: resume.createdAt.toISOString(),
    versions: (resume.versions ?? []).map((version) => ({
      id: version.id,
      label: version.label,
      createdAt: version.createdAt.toISOString(),
    })),
  };
}

export function serializeApplicationDetail(
  application: Application & {
    job: Job & { source: JobSource };
    generatedAnswers: PrismaGeneratedAnswer[];
    events: ApplicationEvent[];
    notifications: PrismaNotification[];
    tailoredDocuments: TailoredDocument[];
    resumeVersions: ResumeVersion[];
  },
) {
  return {
    id: application.id,
    company: application.job.company,
    title: application.job.title,
    source: application.job.source.name,
    fitScore: application.fitScoreSnapshot,
    status: toCoreApplicationStatus(application.status),
    blockingReason: application.blockingReason,
    manualActionType: application.manualActionType?.toLowerCase() ?? null,
    jobUrl: application.job.canonicalUrl,
    applyUrl: application.job.applyUrl ?? application.job.canonicalUrl,
    lastAutomationUrl: application.lastAutomationUrl,
    preparedPayload: application.preparedPayload,
    automationSession: application.automationSession,
    simpleFlowConfirmed: application.simpleFlowConfirmed,
    highConfidence: application.highConfidence,
    preparedAt: application.preparedAt?.toISOString() ?? null,
    autoSubmittedAt: application.autoSubmittedAt?.toISOString() ?? null,
    submittedAt: application.submittedAt?.toISOString() ?? null,
    needsUserActionAt: application.needsUserActionAt?.toISOString() ?? null,
    updatedAt: application.updatedAt.toISOString(),
    generatedAnswers: serializeGeneratedAnswers(application.generatedAnswers),
    events: application.events.map((event) => ({
      id: event.id,
      type: event.type.toLowerCase(),
      actor: event.actor,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
    notifications: application.notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
    })),
    resumeVersions: application.resumeVersions.map((version) => ({
      id: version.id,
      label: version.label,
      contentText: version.contentText,
      createdAt: version.createdAt.toISOString(),
    })),
    tailoredDocuments: application.tailoredDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      kind: document.kind.toLowerCase(),
      contentText: document.contentText,
      contentJson: document.contentJson,
      createdAt: document.createdAt.toISOString(),
    })),
  };
}

export function serializeGeneratedAnswerKind(kind: GeneratedAnswerKind): GeneratedAnswer["kind"] {
  switch (kind) {
    case "WHY_ROLE":
      return "why_role";
    case "WHY_FIT":
      return "why_fit";
    case "ANYTHING_ELSE":
      return "anything_else";
    case "CUSTOM":
    default:
      return "custom";
  }
}

export type UserWorkspace = User & {
  profile: UserProfile | null;
  preferences: UserPreference | null;
  resumes: Array<Resume & { versions: ResumeVersion[] }>;
};
