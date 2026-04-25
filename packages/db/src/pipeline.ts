import type {
  GeneratedAnswerSet,
  JobPosting,
  JobSeniorityAssessment,
  TailoredResumeDraft,
} from "@jobhunter/core";
import { Prisma, type ApplicationStatus, type JobSourceKind, type ManualActionType, JobSeniorityLevel, WorkMode } from "@prisma/client";

import { prisma } from "./index";

export async function ensureJobSource(input: {
  slug: string;
  name: string;
  kind: JobSourceKind;
  baseUrl?: string;
  configuration?: Record<string, unknown>;
}) {
  return prisma.jobSource.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      configuration: toOptionalJson(input.configuration),
      isEnabled: true,
    },
    create: {
      slug: input.slug,
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      configuration: toOptionalJson(input.configuration),
      isEnabled: true,
    },
  });
}

export async function upsertDiscoveredJob(input: {
  sourceId: string;
  job: JobPosting;
  rawPayload?: unknown;
  seniorityAssessment?: JobSeniorityAssessment;
}) {
  const { sourceId, job, rawPayload } = input;
  const sharedUpdate = {
    sourceId,
    externalId: job.externalId,
    canonicalUrl: job.url,
    applyUrl: job.applyUrl,
    company: job.company,
    title: job.title,
    locationText: job.location,
    seniorityLevel: toPrismaJobSeniority(input.seniorityAssessment?.level ?? job.seniority),
    seniorityConfidence: input.seniorityAssessment?.confidence ?? job.seniorityConfidence ?? null,
    seniorityReason: input.seniorityAssessment?.reasoning ?? null,
    workMode: toPrismaWorkMode(job.workMode),
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryCurrency: job.salaryCurrency,
    descriptionText: job.description,
    rawPayload: toOptionalJson(rawPayload),
    lastSeenAt: new Date(),
  };

  if (job.externalId) {
    return prisma.job.upsert({
      where: {
        sourceId_externalId: {
          sourceId,
          externalId: job.externalId,
        },
      },
      update: sharedUpdate,
      create: {
        ...sharedUpdate,
        discoveredAt: new Date(job.discoveredAt),
        firstSeenAt: new Date(job.discoveredAt),
      },
    });
  }

  return prisma.job.upsert({
    where: {
      canonicalUrl: job.url,
    },
    update: sharedUpdate,
    create: {
      ...sharedUpdate,
      discoveredAt: new Date(job.discoveredAt),
      firstSeenAt: new Date(job.discoveredAt),
    },
  });
}

export async function recordApplicationEvent(input: {
  applicationId: string;
  type:
    | "DISCOVERED"
    | "SCORED"
    | "FILTERED"
    | "QUEUED"
    | "PREPARED"
    | "AUTO_SUBMITTED"
    | "NEEDS_USER_ACTION"
    | "SUBMITTED"
    | "RESPONDED"
    | "INTERVIEW"
    | "REJECTED"
    | "OFFER"
    | "ERROR"
    | "NOTE";
  actor: string;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.applicationEvent.create({
    data: {
      applicationId: input.applicationId,
      type: input.type,
      actor: input.actor,
      title: input.title,
      detail: input.detail,
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export async function createNotification(input: {
  userId: string;
  applicationId?: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "ACTION_REQUIRED";
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      applicationId: input.applicationId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
      metadata: toOptionalJson(input.metadata),
    },
  });
}

export async function upsertUserScore(input: {
  userId: string;
  jobId: string;
  fitScore: number;
  decision: boolean;
  confidence: number;
  topMatches: string[];
  majorGaps: string[];
  weightedBreakdown: Record<string, unknown>;
  ruleBreakdown: Record<string, unknown>;
  llmResponse?: Record<string, unknown>;
}) {
  return prisma.jobScore.upsert({
    where: {
      userId_jobId: {
        userId: input.userId,
        jobId: input.jobId,
      },
    },
    update: {
      fitScore: input.fitScore,
      decision: input.decision,
      confidence: input.confidence,
      topMatches: input.topMatches,
      majorGaps: input.majorGaps,
      weightedBreakdown: toRequiredJson(input.weightedBreakdown),
      ruleBreakdown: toRequiredJson(input.ruleBreakdown),
      llmResponse: toOptionalJson(input.llmResponse),
    },
    create: {
      userId: input.userId,
      jobId: input.jobId,
      fitScore: input.fitScore,
      decision: input.decision,
      confidence: input.confidence,
      topMatches: input.topMatches,
      majorGaps: input.majorGaps,
      weightedBreakdown: toRequiredJson(input.weightedBreakdown),
      ruleBreakdown: toRequiredJson(input.ruleBreakdown),
      llmResponse: toOptionalJson(input.llmResponse),
    },
  });
}

export async function ensureApplicationRecord(input: {
  userId: string;
  jobId: string;
  sourceId?: string;
  resumeId?: string;
  scoreId?: string;
  fitScoreSnapshot?: number;
  fitThresholdSnapshot: number;
  status: ApplicationStatus;
  simpleFlowConfirmed?: boolean;
  highConfidence?: boolean;
  preparedPayload?: Record<string, unknown>;
  blockingReason?: string | null;
  manualActionType?: ManualActionType | null;
  lastAutomationUrl?: string | null;
  automationSession?: Record<string, unknown> | null;
  preparedAt?: Date | null;
  autoSubmittedAt?: Date | null;
  submittedAt?: Date | null;
  needsUserActionAt?: Date | null;
}) {
  return prisma.application.upsert({
    where: {
      userId_jobId: {
        userId: input.userId,
        jobId: input.jobId,
      },
    },
    update: {
      sourceId: input.sourceId,
      resumeId: input.resumeId,
      scoreId: input.scoreId,
      fitScoreSnapshot: input.fitScoreSnapshot,
      fitThresholdSnapshot: input.fitThresholdSnapshot,
      status: input.status,
      simpleFlowConfirmed: input.simpleFlowConfirmed ?? false,
      highConfidence: input.highConfidence ?? false,
      preparedPayload: toOptionalJson(input.preparedPayload),
      blockingReason: input.blockingReason ?? null,
      manualActionType: input.manualActionType ?? null,
      lastAutomationUrl: input.lastAutomationUrl ?? null,
      automationSession: toOptionalJson(input.automationSession),
      preparedAt: optionalDateValue(input.preparedAt),
      autoSubmittedAt: optionalDateValue(input.autoSubmittedAt),
      submittedAt: optionalDateValue(input.submittedAt),
      needsUserActionAt: optionalDateValue(input.needsUserActionAt),
    },
    create: {
      userId: input.userId,
      jobId: input.jobId,
      sourceId: input.sourceId,
      resumeId: input.resumeId,
      scoreId: input.scoreId,
      fitScoreSnapshot: input.fitScoreSnapshot,
      fitThresholdSnapshot: input.fitThresholdSnapshot,
      status: input.status,
      simpleFlowConfirmed: input.simpleFlowConfirmed ?? false,
      highConfidence: input.highConfidence ?? false,
      preparedPayload: toOptionalJson(input.preparedPayload),
      blockingReason: input.blockingReason ?? null,
      manualActionType: input.manualActionType ?? null,
      lastAutomationUrl: input.lastAutomationUrl ?? null,
      automationSession: toOptionalJson(input.automationSession),
      preparedAt: optionalDateValue(input.preparedAt),
      autoSubmittedAt: optionalDateValue(input.autoSubmittedAt),
      submittedAt: optionalDateValue(input.submittedAt),
      needsUserActionAt: optionalDateValue(input.needsUserActionAt),
    },
  });
}

export async function replaceTailoredArtifacts(input: {
  applicationId: string;
  userId: string;
  jobId: string;
  resumeId: string;
  tailoredResume: TailoredResumeDraft;
  generatedAnswers: GeneratedAnswerSet;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.tailoredDocument.deleteMany({
      where: { applicationId: input.applicationId },
    });
    await tx.generatedAnswer.deleteMany({
      where: { applicationId: input.applicationId },
    });

    await tx.tailoredDocument.create({
      data: {
        userId: input.userId,
        jobId: input.jobId,
        applicationId: input.applicationId,
        resumeId: input.resumeId,
        kind: "RESUME",
        title: "Tailored resume draft",
        contentText: input.tailoredResume.tailoredBullets.join("\n"),
        contentJson: toRequiredJson(input.tailoredResume),
      },
    });

    await tx.resumeVersion.create({
      data: {
        resumeId: input.resumeId,
        applicationId: input.applicationId,
        label: "Tailored resume version",
        contentText: [input.tailoredResume.summaryLine, ...input.tailoredResume.tailoredBullets].join("\n"),
      },
    });

    for (const answer of input.generatedAnswers.items) {
      await tx.generatedAnswer.create({
        data: {
          userId: input.userId,
          jobId: input.jobId,
          applicationId: input.applicationId,
          kind: answer.kind.toUpperCase() as never,
          questionText: answer.question,
          answerText: answer.answer,
          fingerprint: `${input.applicationId}:${answer.kind}:${answer.question}`,
        },
      });
    }
  });
}

export async function getOnboardedUsersForPipeline() {
  return prisma.user.findMany({
    where: {
      onboardingCompletedAt: {
        not: null,
      },
    },
    include: {
      profile: true,
      preferences: true,
      resumes: {
        where: {
          isDefault: true,
        },
        include: {
          versions: true,
        },
        take: 1,
      },
    },
  });
}

export async function reconcileApplicationStateConsistency(userId: string) {
  await prisma.$transaction([
    prisma.application.updateMany({
      where: {
        userId,
        status: "PREPARED",
        autoSubmittedAt: {
          not: null,
        },
      },
      data: {
        status: "AUTO_SUBMITTED",
        blockingReason: null,
        manualActionType: null,
        needsUserActionAt: null,
      },
    }),
    prisma.application.updateMany({
      where: {
        userId,
        status: "PREPARED",
        autoSubmittedAt: null,
        submittedAt: {
          not: null,
        },
      },
      data: {
        status: "SUBMITTED",
        blockingReason: null,
        manualActionType: null,
        needsUserActionAt: null,
      },
    }),
    prisma.application.updateMany({
      where: {
        userId,
        status: "PREPARED",
        OR: [
          {
            needsUserActionAt: {
              not: null,
            },
          },
          {
            manualActionType: {
              not: null,
            },
          },
          {
            blockingReason: {
              not: null,
            },
          },
        ],
      },
      data: {
        blockingReason: null,
        manualActionType: null,
        needsUserActionAt: null,
      },
    }),
    prisma.application.updateMany({
      where: {
        userId,
        status: {
          in: ["AUTO_SUBMITTED", "SUBMITTED"],
        },
        OR: [
          {
            needsUserActionAt: {
              not: null,
            },
          },
          {
            manualActionType: {
              not: null,
            },
          },
          {
            blockingReason: {
              not: null,
            },
          },
        ],
      },
      data: {
        blockingReason: null,
        manualActionType: null,
        needsUserActionAt: null,
      },
    }),
    prisma.application.updateMany({
      where: {
        userId,
        status: "NEEDS_USER_ACTION",
        OR: [
          {
            autoSubmittedAt: {
              not: null,
            },
          },
          {
            submittedAt: {
              not: null,
            },
          },
        ],
      },
      data: {
        autoSubmittedAt: null,
        submittedAt: null,
      },
    }),
  ]);
}

export async function findPromptTemplate(taskKind: "JOB_SCORER" | "RESUME_TAILOR" | "SHORT_ANSWER_GENERATOR") {
  return prisma.promptTemplate.findFirst({
    where: {
      taskKind,
      isActive: true,
    },
    orderBy: [
      { scope: "desc" },
      { version: "desc" },
    ],
  });
}

export async function getApplicationByIdForUser(userId: string, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      job: {
        include: {
          source: true,
        },
      },
      generatedAnswers: true,
      events: {
        orderBy: {
          createdAt: "desc",
        },
      },
      notifications: {
        orderBy: {
          createdAt: "desc",
        },
      },
      tailoredDocuments: {
        orderBy: {
          createdAt: "desc",
        },
      },
      resumeVersions: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function updateApplicationAfterAutomation(input: {
  applicationId: string;
  status: ApplicationStatus;
  blockingReason?: string | null;
  manualActionType?: ManualActionType | null;
  lastAutomationUrl?: string | null;
  automationSession?: Record<string, unknown> | null;
  autoSubmittedAt?: Date | null;
  submittedAt?: Date | null;
  needsUserActionAt?: Date | null;
}) {
  return prisma.application.update({
    where: { id: input.applicationId },
    data: {
      status: input.status,
      blockingReason: input.blockingReason ?? null,
      manualActionType: input.manualActionType ?? null,
      lastAutomationUrl: input.lastAutomationUrl ?? null,
      automationSession: toOptionalJson(input.automationSession),
      autoSubmittedAt: optionalDateValue(input.autoSubmittedAt),
      submittedAt: optionalDateValue(input.submittedAt),
      needsUserActionAt: optionalDateValue(input.needsUserActionAt),
    },
  });
}

export async function getApplicationGeneratedAnswers(applicationId: string) {
  return prisma.generatedAnswer.findMany({
    where: { applicationId },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export async function getLatestResumeForUser(userId: string) {
  return prisma.resume.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function markOlderNotificationsReadForApplication(userId: string, applicationId: string) {
  await prisma.notification.updateMany({
    where: {
      userId,
      applicationId,
      status: "UNREAD",
    },
    data: {
      status: "READ",
      readAt: new Date(),
    },
  });
}

function toOptionalJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}

function optionalDateValue(value: Date | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value;
}

function toRequiredJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return {} as Prisma.InputJsonValue;
  }
  return value as Prisma.InputJsonValue;
}

function toPrismaWorkMode(mode: JobPosting["workMode"] | undefined): WorkMode | null {
  switch (mode) {
    case "remote":
      return WorkMode.REMOTE;
    case "hybrid":
      return WorkMode.HYBRID;
    case "on_site":
      return WorkMode.ON_SITE;
    case "flexible":
      return WorkMode.FLEXIBLE;
    default:
      return null;
  }
}

function toPrismaJobSeniority(level: JobPosting["seniority"] | undefined): JobSeniorityLevel | null {
  switch (level) {
    case "entry":
      return JobSeniorityLevel.ENTRY;
    case "mid":
      return JobSeniorityLevel.MID;
    case "senior":
      return JobSeniorityLevel.SENIOR;
    default:
      return null;
  }
}
