import type {
  DashboardSnapshot,
  JobPreferences,
  OnboardingInput,
  ResumeUploadInput,
  StructuredProfile,
} from "@jobhunter/core";
import { WorkMode } from "@prisma/client";

import { prisma } from "./index";
import {
  serializeApplicationDetail,
  serializeDashboardSnapshot,
  serializeJobPosting,
  serializeNotification,
  serializePreferences,
  serializeProfile,
  serializeResume,
  type UserWorkspace,
} from "./serializers";

export async function getUserWorkspace(userId: string): Promise<UserWorkspace | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      preferences: true,
      resumes: {
        include: {
          versions: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
        orderBy: [
          { isDefault: "desc" },
          { createdAt: "desc" },
        ],
      },
    },
  });
}

export async function getDashboardSnapshotForUser(userId: string): Promise<DashboardSnapshot> {
  const [applications, notifications, preferences] = await Promise.all([
    prisma.application.findMany({
      where: { userId },
      include: {
        job: {
          include: {
            source: true,
          },
        },
        generatedAnswers: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: {
        dailyTargetVolume: true,
      },
    }),
  ]);

  return serializeDashboardSnapshot({
    applications,
    notifications,
    dailyTargetVolume: preferences?.dailyTargetVolume ?? 15,
  });
}

export async function getJobsForUser(userId: string) {
  const rows = await prisma.job.findMany({
    where: {
      applications: {
        some: {
          userId,
        },
      },
    },
    include: {
      source: true,
      scores: {
        where: { userId },
        take: 1,
      },
      applications: {
        where: { userId },
        take: 1,
      },
    },
    orderBy: {
      discoveredAt: "desc",
    },
  });

  return rows.map((row) =>
    serializeJobPosting({
      job: row,
      score: row.scores[0] ?? null,
      application: row.applications[0] ?? null,
    }),
  );
}

export async function getApplicationsForUser(userId: string) {
  const rows = await prisma.application.findMany({
    where: { userId },
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
    orderBy: {
      updatedAt: "desc",
    },
  });

  return rows.map((row) => serializeApplicationDetail(row));
}

export async function getExistingApplicationsForUser(userId: string) {
  return prisma.application.findMany({
    where: { userId },
    select: {
      id: true,
      jobId: true,
      status: true,
      preparedAt: true,
    },
  });
}

export async function getApplicationAutomationContext(userId: string, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      user: {
        include: {
          profile: true,
          preferences: true,
        },
      },
      job: {
        include: {
          source: true,
        },
      },
      resume: true,
      generatedAnswers: {
        orderBy: {
          createdAt: "asc",
        },
      },
      tailoredDocuments: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function getNotificationsForUser(userId: string) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: {
      createdAt: "desc",
    },
  });
  return notifications.map((notification) => ({
    ...serializeNotification(notification),
    status: notification.status.toLowerCase(),
    body: notification.body,
    actionUrl: notification.actionUrl,
  }));
}

export async function upsertOnboardingData(
  userId: string,
  input: OnboardingInput,
  userEmail: string,
) {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  });
  const profile = input.profile satisfies StructuredProfile;
  const preferences = input.preferences satisfies JobPreferences;
  const graduationDate = new Date(profile.graduationDate);

  await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: profile.fullLegalName,
      onboardingCompletedAt: new Date(),
    },
  });

  await prisma.userProfile.upsert({
    where: { userId },
    update: {
      fullLegalName: profile.fullLegalName,
      phone: profile.phone,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
      workAuthorization: profile.workAuthorization,
      usCitizenStatus: profile.usCitizenStatus,
      requiresVisaSponsorship: profile.requiresVisaSponsorship,
      veteranStatus: profile.veteranStatus,
      disabilityStatus: profile.disabilityStatus,
      school: profile.school,
      degree: profile.degree,
      graduationDate,
      yearsOfExperience: profile.yearsOfExperience,
      currentCompany: profile.currentCompany,
      currentTitle: profile.currentTitle,
      summary: `Candidate profile for ${profile.fullLegalName}`,
    },
    create: {
      userId,
      fullLegalName: profile.fullLegalName,
      phone: profile.phone,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
      portfolioUrl: profile.portfolioUrl,
      workAuthorization: profile.workAuthorization,
      usCitizenStatus: profile.usCitizenStatus,
      requiresVisaSponsorship: profile.requiresVisaSponsorship,
      veteranStatus: profile.veteranStatus,
      disabilityStatus: profile.disabilityStatus,
      school: profile.school,
      degree: profile.degree,
      graduationDate,
      yearsOfExperience: profile.yearsOfExperience,
      currentCompany: profile.currentCompany,
      currentTitle: profile.currentTitle,
      summary: `Candidate profile for ${profile.fullLegalName}`,
    },
  });

  await prisma.userPreference.upsert({
    where: { userId },
    update: {
      targetRoles: preferences.targetRoles,
      targetLocations: preferences.locations,
      workModes: preferences.workModes.map(toPrismaWorkMode),
      salaryFloor: preferences.salaryFloor ?? null,
      fitThreshold: preferences.fitThreshold,
      dailyTargetVolume: preferences.dailyTargetVolume,
      includeKeywords: [],
      excludeKeywords: [],
      sourceKinds: ["MOCK", "GREENHOUSE", "ASHBY", "LEVER", "WORKABLE"],
    },
    create: {
      userId,
      targetRoles: preferences.targetRoles,
      targetLocations: preferences.locations,
      workModes: preferences.workModes.map(toPrismaWorkMode),
      salaryFloor: preferences.salaryFloor ?? null,
      fitThreshold: preferences.fitThreshold,
      dailyTargetVolume: preferences.dailyTargetVolume,
      includeKeywords: [],
      excludeKeywords: [],
      sourceKinds: ["MOCK", "GREENHOUSE", "ASHBY", "LEVER", "WORKABLE"],
    },
  });

  if (!existingUser?.onboardingCompletedAt) {
    await prisma.notification.create({
      data: {
        userId,
        type: "SUCCESS",
        title: "Onboarding complete",
        body: `Your profile for ${userEmail} is ready. Resume uploads and worker runs can start now.`,
        actionUrl: "/dashboard",
      },
    });
  }
}

export async function getProfileBundle(userId: string) {
  const workspace = await getUserWorkspace(userId);
  if (!workspace) {
    return null;
  }

  return {
    onboardingComplete: workspace.onboardingCompletedAt !== null,
    profile: {
      email: workspace.email,
      ...serializeProfile(workspace.profile),
    },
    preferences: serializePreferences(workspace.preferences),
    resumes: workspace.resumes.map((resume) => serializeResume(resume)),
  };
}

export async function createResumeForUser(
  userId: string,
  input: ResumeUploadInput & {
    originalFileName: string;
    mimeType: string;
    storageKey: string;
  },
) {
  const existingDefault = await prisma.resume.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  });
  const shouldBeDefault = input.setAsDefault || !existingDefault;

  if (shouldBeDefault) {
    await prisma.resume.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.resume.create({
    data: {
      userId,
      label: input.label,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      baseText: input.baseText,
      isDefault: shouldBeDefault,
    },
  });
}

export async function listResumesForUser(userId: string) {
  const resumes = await prisma.resume.findMany({
    where: { userId },
    include: {
      versions: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return resumes.map((resume) => serializeResume(resume));
}

export async function reopenApplicationForUser(userId: string, applicationId: string) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
  });
  if (!application) {
    return null;
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: "QUEUED",
      manualActionType: null,
      blockingReason: null,
      needsUserActionAt: null,
    },
  });

  await prisma.applicationEvent.create({
    data: {
      applicationId,
      type: "NOTE",
      actor: "user",
      title: "Application reopened",
      detail: "The application was moved back into the queue for a retry.",
    },
  });

  return true;
}

export async function markApplicationSubmittedForUser(userId: string, applicationId: string) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
  });
  if (!application) {
    return null;
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      manualActionType: null,
      blockingReason: null,
    },
  });

  await prisma.applicationEvent.create({
    data: {
      applicationId,
      type: "SUBMITTED",
      actor: "user",
      title: "Application marked submitted",
      detail: "The user confirmed the application was submitted.",
    },
  });

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

  return true;
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!notification) {
    return null;
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: {
      status: "READ",
      readAt: new Date(),
    },
  });
}

function toPrismaWorkMode(mode: JobPreferences["workModes"][number]) {
  switch (mode) {
    case "remote":
      return WorkMode.REMOTE;
    case "hybrid":
      return WorkMode.HYBRID;
    case "on_site":
      return WorkMode.ON_SITE;
    case "flexible":
    default:
      return WorkMode.FLEXIBLE;
  }
}
