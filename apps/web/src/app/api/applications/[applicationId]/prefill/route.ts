import { buildStructuredApplicationDefaults } from "@jobhunter/core";
import { getApplicationAutomationContext } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };
  const application = await getApplicationAutomationContext(user.id, applicationId);

  if (!application || !application.resume || !application.user.profile || !application.user.preferences) {
    return NextResponse.json(
      { error: "Application context is incomplete." },
      { status: 404 },
    );
  }

  const preparedPayload = isRecord(application.preparedPayload) ? application.preparedPayload : null;
  const fallbackDefaults = buildStructuredApplicationDefaults({
    profile: {
      fullLegalName: application.user.profile.fullLegalName ?? application.user.fullName ?? application.user.email,
      email: application.user.email,
      phone: application.user.profile.phone ?? "",
      city: application.user.profile.city ?? "",
      state: application.user.profile.state ?? "",
      country: application.user.profile.country ?? "United States",
      linkedinUrl: application.user.profile.linkedinUrl ?? undefined,
      githubUrl: application.user.profile.githubUrl ?? undefined,
      portfolioUrl: application.user.profile.portfolioUrl ?? undefined,
      workAuthorization: application.user.profile.workAuthorization ?? "Authorized to work in the United States",
      usCitizenStatus: application.user.profile.usCitizenStatus ?? "U.S. Citizen",
      requiresVisaSponsorship: application.user.profile.requiresVisaSponsorship ?? false,
      veteranStatus: application.user.profile.veteranStatus ?? "Not a protected veteran",
      disabilityStatus: application.user.profile.disabilityStatus ?? undefined,
      school: application.user.profile.school ?? "",
      degree: application.user.profile.degree ?? "",
      graduationDate: application.user.profile.graduationDate?.toISOString().slice(0, 10) ?? "",
      yearsOfExperience: application.user.profile.yearsOfExperience ?? 0,
      currentCompany: application.user.profile.currentCompany ?? "",
      currentTitle: application.user.profile.currentTitle ?? "",
    },
    preferences: {
      targetRoles: application.user.preferences.targetRoles,
      locations: application.user.preferences.targetLocations,
      workModes: application.user.preferences.workModes.map((mode) => mode.toLowerCase()) as Array<"remote" | "hybrid" | "on_site" | "flexible">,
      salaryFloor: application.user.preferences.salaryFloor ?? undefined,
      fitThreshold: application.user.preferences.fitThreshold,
      dailyTargetVolume: application.user.preferences.dailyTargetVolume,
    },
    generatedAnswers: application.generatedAnswers.map((answer) => ({
      kind: answer.kind.toLowerCase() as "why_role" | "why_fit" | "anything_else" | "custom",
      question: answer.questionText,
      answer: answer.answerText,
    })),
  });
  const preparedDefaults = isRecord(preparedPayload?.structuredDefaults) ? preparedPayload.structuredDefaults : null;
  const structuredDefaults = preparedDefaults
    ? Object.assign({}, fallbackDefaults, preparedDefaults)
    : fallbackDefaults;

  return NextResponse.json({
    applicationId: application.id,
    company: application.job.company,
    role: application.job.title,
    status: application.status.toLowerCase(),
    jobUrl: application.job.canonicalUrl,
    applyUrl: application.job.applyUrl ?? application.job.canonicalUrl,
    structuredDefaults,
    generatedAnswers: application.generatedAnswers.map((answer) => ({
      kind: answer.kind.toLowerCase(),
      question: answer.questionText,
      answer: answer.answerText,
    })),
    resume: {
      label: application.resume.label,
      originalFileName: application.resume.originalFileName,
      storageKey: application.resume.storageKey,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
