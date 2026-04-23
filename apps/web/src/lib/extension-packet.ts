import {
  buildStructuredApplicationDefaults,
  resolveDataPath,
  type GeneratedAnswer,
  type GeneratedAnswerSet,
  type JobPosting,
  type JobPreferences,
  type StructuredApplicationDefaults,
  type StructuredProfile,
  type TailoredResumeDraft,
} from "@jobhunter/core";
import {
  ensureApplicationRecord,
  recordApplicationEvent,
  replaceTailoredArtifacts,
} from "@jobhunter/db";
import { ResumeTailorService, ShortAnswerGeneratorService } from "@jobhunter/llm";

type AutomationContext = NonNullable<Awaited<ReturnType<typeof import("@jobhunter/db").getApplicationAutomationContext>>>;

export async function buildExtensionAutofillPacket(input: {
  context: AutomationContext;
  appBaseUrl: string;
  refreshMaterials: boolean;
}) {
  const resume = input.context.resume;
  const profileRecord = input.context.user.profile;
  const preferenceRecord = input.context.user.preferences;
  if (!resume || !profileRecord || !preferenceRecord) {
    throw new Error("Application context is missing required profile, preference, or resume records.");
  }

  const profile = toStructuredProfile(input.context);
  const preferences = toJobPreferences(input.context);
  const job = toJobPosting(input.context);
  const existingPreparedPayload = isRecord(input.context.preparedPayload) ? input.context.preparedPayload : {};
  const existingFieldOverrides = isRecord(existingPreparedPayload.fieldOverrides)
    ? normalizeFieldOverrides(existingPreparedPayload.fieldOverrides)
    : {};
  const preparedTailoredResume = coerceTailoredResume(existingPreparedPayload.tailoredResume);
  const persistedAnswers = input.context.generatedAnswers.map((answer) => ({
    kind: answer.kind.toLowerCase() as GeneratedAnswer["kind"],
    question: answer.questionText,
    answer: answer.answerText,
  }));
  const preparedAnswers = coercePreparedGeneratedAnswers(existingPreparedPayload.generatedAnswers);
  const fallbackAnswers = preparedAnswers.length > 0 ? preparedAnswers : persistedAnswers;

  let tailoredResume = preparedTailoredResume;
  let generatedAnswers = fallbackAnswers;
  const needsRefresh = input.refreshMaterials || !tailoredResume || generatedAnswers.length === 0;

  if (needsRefresh) {
    const tailor = new ResumeTailorService();
    const answerGenerator = new ShortAnswerGeneratorService();
    tailoredResume = await tailor.tailor({
      job,
      resumeText: resume.baseText,
    });
    const refreshed = await answerGenerator.generate({
      job,
      profile,
      tailoredResume,
    });
    generatedAnswers = refreshed.items as GeneratedAnswer[];

    const structuredDefaults = buildStructuredApplicationDefaults({
      profile,
      preferences,
      tailoredResume,
      generatedAnswers,
    });

    await ensureApplicationRecord({
      userId: input.context.userId,
      jobId: input.context.jobId,
      sourceId: input.context.sourceId ?? undefined,
      resumeId: input.context.resumeId ?? resume.id,
      scoreId: input.context.scoreId ?? undefined,
      fitScoreSnapshot: input.context.fitScoreSnapshot ?? undefined,
      fitThresholdSnapshot: input.context.fitThresholdSnapshot,
      status: input.context.status,
      simpleFlowConfirmed: input.context.simpleFlowConfirmed,
      highConfidence: input.context.highConfidence,
      preparedPayload: {
        ...existingPreparedPayload,
        structuredDefaults,
        generatedAnswers: { items: generatedAnswers },
        tailoredResume,
        resumePath: resolveDataPath(resume.storageKey),
      },
      blockingReason: input.context.blockingReason,
      manualActionType: input.context.manualActionType,
      lastAutomationUrl: input.context.lastAutomationUrl,
      automationSession: isRecord(input.context.automationSession)
        ? (input.context.automationSession as Record<string, unknown>)
        : undefined,
      preparedAt: input.context.preparedAt ?? new Date(),
      autoSubmittedAt: input.context.autoSubmittedAt,
      submittedAt: input.context.submittedAt,
      needsUserActionAt: input.context.needsUserActionAt,
    });

    await replaceTailoredArtifacts({
      applicationId: input.context.id,
      userId: input.context.userId,
      jobId: input.context.jobId,
      resumeId: input.context.resumeId ?? resume.id,
      tailoredResume,
      generatedAnswers: {
        items: generatedAnswers,
      } satisfies GeneratedAnswerSet,
    });

    await recordApplicationEvent({
      applicationId: input.context.id,
      type: "NOTE",
      actor: "system",
      title: "Extension packet refreshed",
      detail: "Tailored resume content and short answers were refreshed for in-browser extension autofill.",
    });
  }

  const structuredDefaults = buildStructuredApplicationDefaults({
    profile,
    preferences,
    tailoredResume,
    generatedAnswers,
  });

  return {
    applicationId: input.context.id,
    company: input.context.job.company,
    role: input.context.job.title,
    source: input.context.job.source.name,
    status: input.context.status.toLowerCase(),
    jobUrl: input.context.job.canonicalUrl,
    applyUrl: input.context.job.applyUrl ?? input.context.job.canonicalUrl,
    manualActionType: input.context.manualActionType?.toLowerCase() ?? null,
    blockingReason: input.context.blockingReason,
    fieldOverrides: existingFieldOverrides,
    structuredDefaults,
    generatedAnswers,
    tailoredResume,
    resume: {
      label: resume.label,
      originalFileName: resume.originalFileName,
      mimeType: resume.mimeType,
      fileUrl: `${input.appBaseUrl.replace(/\/$/, "")}/api/extension/resume-file?applicationId=${encodeURIComponent(input.context.id)}`,
    },
  };
}

function toStructuredProfile(context: AutomationContext): StructuredProfile {
  return {
    fullLegalName: context.user.profile?.fullLegalName ?? context.user.fullName ?? context.user.email,
    email: context.user.email,
    phone: context.user.profile?.phone ?? "",
    city: context.user.profile?.city ?? "",
    state: context.user.profile?.state ?? "",
    country: context.user.profile?.country ?? "United States",
    linkedinUrl: context.user.profile?.linkedinUrl ?? undefined,
    githubUrl: context.user.profile?.githubUrl ?? undefined,
    portfolioUrl: context.user.profile?.portfolioUrl ?? undefined,
    workAuthorization: context.user.profile?.workAuthorization ?? "Authorized to work in the United States",
    usCitizenStatus: context.user.profile?.usCitizenStatus ?? "U.S. Citizen",
    requiresVisaSponsorship: context.user.profile?.requiresVisaSponsorship ?? false,
    veteranStatus: context.user.profile?.veteranStatus ?? "Not a protected veteran",
    disabilityStatus: context.user.profile?.disabilityStatus ?? undefined,
    school: context.user.profile?.school ?? "",
    degree: context.user.profile?.degree ?? "",
    graduationDate: context.user.profile?.graduationDate?.toISOString().slice(0, 10) ?? "",
    yearsOfExperience: context.user.profile?.yearsOfExperience ?? 0,
    currentCompany: context.user.profile?.currentCompany ?? "",
    currentTitle: context.user.profile?.currentTitle ?? "",
  };
}

function toJobPreferences(context: AutomationContext): JobPreferences {
  const preference = context.user.preferences;
  return {
    targetRoles: preference?.targetRoles ?? ["software engineer"],
    locations: preference?.targetLocations ?? ["Remote"],
    workModes: (preference?.workModes.map((mode) => mode.toLowerCase()) ?? ["remote"]) as JobPreferences["workModes"],
    seniorityTargets: (
      preference?.seniorityTargets && preference.seniorityTargets.length > 0
        ? preference.seniorityTargets.map((level) => level.toLowerCase())
        : ["entry", "mid"]
    ) as JobPreferences["seniorityTargets"],
    salaryFloor: preference?.salaryFloor ?? undefined,
    fitThreshold: preference?.fitThreshold ?? 70,
    dailyTargetVolume: preference?.dailyTargetVolume ?? 15,
    includeKeywords: preference?.includeKeywords ?? [],
    excludeKeywords: preference?.excludeKeywords ?? [],
    sourceKinds: (
      preference?.sourceKinds && preference.sourceKinds.length > 0
        ? preference.sourceKinds.map((kind) => kind.toLowerCase())
        : ["greenhouse", "ashby", "lever", "workable", "mock"]
    ) as JobPreferences["sourceKinds"],
  };
}

function toJobPosting(context: AutomationContext): JobPosting {
  return {
    id: context.job.id,
    externalId: context.job.externalId ?? undefined,
    sourceKind: context.job.source.kind.toLowerCase() as JobPosting["sourceKind"],
    sourceName: context.job.source.name,
    company: context.job.company,
    title: context.job.title,
    location: context.job.locationText ?? "",
    seniority: context.job.seniorityLevel?.toLowerCase() as JobPosting["seniority"] | undefined,
    seniorityConfidence: context.job.seniorityConfidence ?? undefined,
    workMode: context.job.workMode?.toLowerCase() as JobPosting["workMode"] | undefined,
    salaryMin: context.job.salaryMin ?? undefined,
    salaryMax: context.job.salaryMax ?? undefined,
    salaryCurrency: context.job.salaryCurrency ?? "USD",
    description: context.job.descriptionText,
    url: context.job.canonicalUrl,
    applyUrl: context.job.applyUrl ?? undefined,
    discoveredAt: context.job.discoveredAt.toISOString(),
  };
}

function coercePreparedGeneratedAnswers(value: unknown): GeneratedAnswer[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return [];
  }
  return value.items
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const kind = typeof item.kind === "string" ? item.kind : "";
      const question = typeof item.question === "string" ? item.question : "";
      const answer = typeof item.answer === "string" ? item.answer : "";
      if (!question.trim() || !answer.trim()) {
        return null;
      }
      if (!["why_role", "why_fit", "anything_else", "custom"].includes(kind)) {
        return null;
      }
      return {
        kind: kind as GeneratedAnswer["kind"],
        question,
        answer,
      };
    })
    .filter((item): item is GeneratedAnswer => item !== null);
}

function coerceTailoredResume(value: unknown): TailoredResumeDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const summaryLine = typeof value.summaryLine === "string" ? value.summaryLine.trim() : "";
  const tailoredBullets = Array.isArray(value.tailoredBullets)
    ? value.tailoredBullets.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const keywordHighlights = Array.isArray(value.keywordHighlights)
    ? value.keywordHighlights.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (!summaryLine || tailoredBullets.length === 0) {
    return null;
  }

  return {
    summaryLine,
    tailoredBullets,
    keywordHighlights,
  };
}

function normalizeFieldOverrides(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string")
      .map(([label, item]) => [normalizeFieldOverrideKey(label), String(item).trim()])
      .filter(([, item]) => item.length > 0),
  );
}

function normalizeFieldOverrideKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
