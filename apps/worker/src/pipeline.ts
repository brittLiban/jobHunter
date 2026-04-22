import { applyToGreenhouseJob, applyToMockJob } from "@jobhunter/automation";
import {
  buildStructuredApplicationDefaults,
  evaluateJobRules,
  meetsFitThreshold,
  resolveDataPath,
  type GeneratedAnswer,
  type JobPreferences,
  type StructuredProfile,
} from "@jobhunter/core";
import {
  createNotification,
  ensureApplicationRecord,
  ensureJobSource,
  getApplicationAutomationContext,
  getExistingApplicationsForUser,
  getOnboardedUsersForPipeline,
  markOlderNotificationsReadForApplication,
  reconcileApplicationStateConsistency,
  recordApplicationEvent,
  replaceTailoredArtifacts,
  updateApplicationAfterAutomation,
  upsertDiscoveredJob,
  upsertUserScore,
} from "@jobhunter/db";
import { buildDefaultSourceTargetsFromEnv, discoverJobsForTargets } from "@jobhunter/job-sources";
import {
  JobScorerService,
  ResumeTailorService,
  ShortAnswerGeneratorService,
} from "@jobhunter/llm";

type PipelineOptions = {
  onlyUserId?: string;
};

export async function runPipeline(options: PipelineOptions = {}) {
  const sourceTargets = buildDefaultSourceTargetsFromEnv();
  const scorer = new JobScorerService();
  const tailor = new ResumeTailorService();
  const answerGenerator = new ShortAnswerGeneratorService();

  const sourceRecords = await Promise.all(
    sourceTargets.map((target) =>
      ensureJobSource({
        slug: target.kind === "mock" ? "mock-demo-feed" : `${target.kind}-primary`,
        name: target.sourceName,
        kind: target.kind.toUpperCase() as never,
        configuration: {
          identifiers: target.identifiers,
        },
      }),
    ),
  );

  const jobs = await discoverJobsForTargets(sourceTargets);
  const jobsBySourceKind = new Map(sourceTargets.map((target, index) => [target.kind, sourceRecords[index]]));

  const persistedJobs = await Promise.all(
    jobs.map((job) =>
      upsertDiscoveredJob({
        sourceId: jobsBySourceKind.get(job.sourceKind)?.id ?? sourceRecords[0].id,
        job,
        rawPayload: job,
      }),
    ),
  );

  const users = (await getOnboardedUsersForPipeline()).filter(
    (user) => !options.onlyUserId || user.id === options.onlyUserId,
  );

  const results = {
    discoveredJobs: persistedJobs.length,
    processedUsers: users.length,
    scoredApplications: 0,
    preparedApplications: 0,
    autoSubmittedApplications: 0,
    needsUserActionApplications: 0,
    skippedApplications: 0,
  };

  for (const user of users) {
    if (!user.profile || !user.preferences || user.resumes.length === 0) {
      continue;
    }

    const profile = toStructuredProfile(user);
    const preferences = toJobPreferences(user);
    const resume = user.resumes[0];
    const resumePath = resolveDataPath(resume.storageKey);
    await reconcileApplicationStateConsistency(user.id);
    const existingApplications = await getExistingApplicationsForUser(user.id);
    const existingApplicationsByJobId = new Map(existingApplications.map((application) => [application.jobId, application]));

    for (const persistedJob of persistedJobs) {
      const sourceRecord = sourceRecords.find((source) => source.id === persistedJob.sourceId);
      const job = {
        id: persistedJob.id,
        externalId: persistedJob.externalId ?? undefined,
        sourceKind: (sourceRecord?.kind.toLowerCase() ?? "mock") as "mock",
        sourceName: sourceRecord?.name ?? "Unknown Source",
        company: persistedJob.company,
        title: persistedJob.title,
        location: persistedJob.locationText ?? "",
        workMode: persistedJob.workMode ? (persistedJob.workMode.toLowerCase() as "remote" | "hybrid" | "on_site" | "flexible") : undefined,
        salaryMin: persistedJob.salaryMin ?? undefined,
        salaryMax: persistedJob.salaryMax ?? undefined,
        salaryCurrency: persistedJob.salaryCurrency ?? "USD",
        description: persistedJob.descriptionText,
        url: persistedJob.canonicalUrl,
        applyUrl: persistedJob.applyUrl ?? undefined,
        discoveredAt: persistedJob.discoveredAt.toISOString(),
      };

      const ruleEvaluation = evaluateJobRules({
        job,
        preferences,
        profile,
        resumeText: resume.baseText,
      });

      const score = await scorer.score({
        job,
        profile,
        resumeText: resume.baseText,
        threshold: preferences.fitThreshold,
      });
      results.scoredApplications += 1;

      const persistedScore = await upsertUserScore({
        userId: user.id,
        jobId: persistedJob.id,
        fitScore: score.fitScore,
        decision: score.decision === "apply",
        confidence: score.confidence,
        topMatches: score.topMatches,
        majorGaps: score.majorGaps,
        weightedBreakdown: score.weightedBreakdown,
        ruleBreakdown: {
          passed: ruleEvaluation.passed,
          reasons: ruleEvaluation.reasons,
        },
      });
      const existingApplication = existingApplicationsByJobId.get(persistedJob.id);
      if (existingApplication && shouldPreserveApplicationStatus(existingApplication.status)) {
        continue;
      }

      const thresholdPassed = ruleEvaluation.passed && meetsFitThreshold(score.fitScore, preferences.fitThreshold);
      if (!thresholdPassed || score.decision !== "apply") {
        const application = await ensureApplicationRecord({
          userId: user.id,
          jobId: persistedJob.id,
          sourceId: persistedJob.sourceId,
          resumeId: resume.id,
          scoreId: persistedScore.id,
          fitScoreSnapshot: score.fitScore,
          fitThresholdSnapshot: preferences.fitThreshold,
          status: "SKIPPED",
          simpleFlowConfirmed: false,
          highConfidence: false,
          preparedPayload: {
            score,
            ruleEvaluation,
          },
          automationSession: null,
          autoSubmittedAt: null,
          submittedAt: null,
          needsUserActionAt: null,
        });
        await recordApplicationEvent({
          applicationId: application.id,
          type: "FILTERED",
          actor: "system",
          title: "Application skipped",
          detail: ruleEvaluation.reasons.join(" ") || "Fit threshold or apply decision prevented application.",
          metadata: {
            fitScore: score.fitScore,
          },
        });
        results.skippedApplications += 1;
        existingApplicationsByJobId.set(persistedJob.id, application);
        continue;
      }

      const tailoredResume = await tailor.tailor({
        job,
        resumeText: resume.baseText,
      });
      const generatedAnswers = await answerGenerator.generate({
        job,
        profile,
        tailoredResume,
      });

      const structuredDefaults = buildStructuredApplicationDefaults({
        profile,
        preferences,
        tailoredResume,
        generatedAnswers: generatedAnswers.items as GeneratedAnswer[],
      });

      const application = await ensureApplicationRecord({
        userId: user.id,
        jobId: persistedJob.id,
        sourceId: persistedJob.sourceId,
        resumeId: resume.id,
        scoreId: persistedScore.id,
        fitScoreSnapshot: score.fitScore,
        fitThresholdSnapshot: preferences.fitThreshold,
        status: "PREPARED",
        simpleFlowConfirmed: isSimpleFlow(job.url),
        highConfidence: score.confidence >= 0.8,
        preparedPayload: {
          structuredDefaults,
          generatedAnswers,
          tailoredResume,
          resumePath,
        },
        automationSession: null,
        preparedAt: new Date(),
        autoSubmittedAt: null,
        submittedAt: null,
        needsUserActionAt: null,
      });

      await replaceTailoredArtifacts({
        applicationId: application.id,
        userId: user.id,
        jobId: persistedJob.id,
        resumeId: resume.id,
        tailoredResume,
        generatedAnswers,
      });

      await recordApplicationEvent({
        applicationId: application.id,
        type: "PREPARED",
        actor: "system",
        title: "Application prepared",
        detail: "Structured profile fields, tailored resume content, and generated answers were saved.",
        metadata: {
          fitScore: score.fitScore,
          confidence: score.confidence,
        },
      });
      results.preparedApplications += 1;
      existingApplicationsByJobId.set(persistedJob.id, application);

      if (!autoApplyEnabled() || !job.url.includes("greenhouse")) {
        continue;
      }

      const result = await applyToGreenhouseJob({
        jobUrl: job.applyUrl ?? job.url,
        defaults: structuredDefaults,
        resumePath,
        generatedAnswers: generatedAnswers.items as GeneratedAnswer[],
        applicationId: application.id,
        dryRun: autoApplyDryRun(),
      });
      const outcome = await persistAutomationOutcome({
        userId: user.id,
        applicationId: application.id,
        company: job.company,
        successTitle: "Application auto-submitted",
        successDetail: result.confirmationText ?? "Greenhouse confirmation state detected.",
        result,
      });
      if (outcome === "auto_submitted") {
        results.autoSubmittedApplications += 1;
      }
      if (outcome === "needs_user_action") {
        results.needsUserActionApplications += 1;
      }
    }
  }

  return results;
}

export async function autofillApplicationForUser(input: {
  userId: string;
  applicationId: string;
}) {
  const context = await getApplicationAutomationContext(input.userId, input.applicationId);
  if (!context || !context.resume || !context.user.profile || !context.user.preferences) {
    return {
      ok: false as const,
      reason: "Application context is incomplete. Ensure onboarding and a default resume are present.",
    };
  }

  const applyTarget = context.job.applyUrl ?? context.job.canonicalUrl;
  const sourceUrl = context.job.applyUrl ?? context.job.canonicalUrl;
  const isMock = isMockFlow(sourceUrl);
  const isGreenhouse = isGreenhouseFlow(sourceUrl);

  if (!isMock && !isGreenhouse) {
    return {
      ok: false as const,
      reason: "Autofill is not supported for this ATS yet.",
    };
  }

  if (!isMock && !externalAutofillEnabled()) {
    return {
      ok: false as const,
      reason: "External Autofill is disabled. Enable JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED=true to run live autofill against non-local job sites.",
    };
  }

  const structuredDefaults = extractStructuredDefaults(context);
  const generatedAnswers = context.generatedAnswers.map((answer) => ({
    kind: answer.kind.toLowerCase() as GeneratedAnswer["kind"],
    question: answer.questionText,
    answer: answer.answerText,
  }));
  const resumePath = resolveDataPath(context.resume.storageKey);

  await recordApplicationEvent({
    applicationId: context.id,
    type: "NOTE",
    actor: "user",
    title: "Autofill requested",
    detail: `A ${isMock ? "mock" : "live"} autofill run was requested from the dashboard.`,
  });

  const result = isMock
    ? await applyToMockJob({
      jobUrl: applyTarget,
      defaults: structuredDefaults,
      resumePath,
      generatedAnswers,
      applicationId: context.id,
      dryRun: false,
    })
    : await applyToGreenhouseJob({
      jobUrl: applyTarget,
      defaults: structuredDefaults,
      resumePath,
      generatedAnswers,
      applicationId: context.id,
      dryRun: false,
    });

  const outcome = await persistAutomationOutcome({
    userId: input.userId,
    applicationId: context.id,
    company: context.job.company,
    successTitle: "Application auto-submitted",
    successDetail: result.confirmationText ?? "Autofill completed and a confirmation state was detected.",
    result,
  });

  return {
    ok: true as const,
    outcome,
    source: result.source,
  };
}

function toStructuredProfile(user: Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>[number]): StructuredProfile {
  return {
    fullLegalName: user.profile?.fullLegalName ?? user.fullName ?? user.email,
    email: user.email,
    phone: user.profile?.phone ?? "",
    city: user.profile?.city ?? "",
    state: user.profile?.state ?? "",
    country: user.profile?.country ?? "United States",
    linkedinUrl: user.profile?.linkedinUrl ?? undefined,
    githubUrl: user.profile?.githubUrl ?? undefined,
    portfolioUrl: user.profile?.portfolioUrl ?? undefined,
    workAuthorization: user.profile?.workAuthorization ?? "Authorized to work in the United States",
    usCitizenStatus: user.profile?.usCitizenStatus ?? "U.S. Citizen",
    requiresVisaSponsorship: user.profile?.requiresVisaSponsorship ?? false,
    veteranStatus: user.profile?.veteranStatus ?? "Not a protected veteran",
    disabilityStatus: user.profile?.disabilityStatus ?? undefined,
    school: user.profile?.school ?? "",
    degree: user.profile?.degree ?? "",
    graduationDate: user.profile?.graduationDate?.toISOString().slice(0, 10) ?? "2025-06-15",
    yearsOfExperience: user.profile?.yearsOfExperience ?? 0,
    currentCompany: user.profile?.currentCompany ?? "",
    currentTitle: user.profile?.currentTitle ?? "",
  };
}

function toJobPreferences(user: Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>[number]): JobPreferences {
  return {
    targetRoles: user.preferences?.targetRoles ?? ["software engineer"],
    locations: user.preferences?.targetLocations ?? ["Remote"],
    workModes: (user.preferences?.workModes.map((mode) => mode.toLowerCase()) ?? ["remote"]) as JobPreferences["workModes"],
    salaryFloor: user.preferences?.salaryFloor ?? undefined,
    fitThreshold: user.preferences?.fitThreshold ?? 70,
    dailyTargetVolume: user.preferences?.dailyTargetVolume ?? 15,
  };
}

function autoApplyEnabled() {
  const raw = process.env.JOBHUNTER_AUTO_APPLY_ENABLED;
  if (raw === undefined) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function autoApplyDryRun() {
  const raw = process.env.JOBHUNTER_AUTO_APPLY_DRY_RUN;
  if (raw === undefined) {
    return true;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function isSimpleFlow(url: string) {
  return isGreenhouseFlow(url) || isMockFlow(url);
}

function isGreenhouseFlow(url: string) {
  return url.includes("greenhouse");
}

function isMockFlow(url: string) {
  return url.includes("/mock/apply/") || url.includes("/mock/jobs/");
}

function externalAutofillEnabled() {
  const raw = process.env.JOBHUNTER_EXTERNAL_AUTOFILL_ENABLED;
  if (raw === undefined) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function shouldPreserveApplicationStatus(status: string) {
  return [
    "NEEDS_USER_ACTION",
    "AUTO_SUBMITTED",
    "SUBMITTED",
    "RESPONDED",
    "INTERVIEW",
    "REJECTED",
    "OFFER",
  ].includes(status);
}

async function persistAutomationOutcome(input: {
  userId: string;
  applicationId: string;
  company: string;
  successTitle: string;
  successDetail: string;
  result: Awaited<ReturnType<typeof applyToGreenhouseJob>>;
}) {
  const { result } = input;

  if (result.success && result.submitted) {
    await updateApplicationAfterAutomation({
      applicationId: input.applicationId,
      status: "AUTO_SUBMITTED",
      blockingReason: null,
      manualActionType: null,
      lastAutomationUrl: result.currentUrl ?? result.applyUrl,
      autoSubmittedAt: new Date(),
      submittedAt: new Date(),
      needsUserActionAt: null,
      automationSession: {
        confirmationText: result.confirmationText,
        preparedPayload: result.preparedPayload,
        filledFields: result.filledFields,
      },
    });
    await markOlderNotificationsReadForApplication(input.userId, input.applicationId);
    await recordApplicationEvent({
      applicationId: input.applicationId,
      type: "AUTO_SUBMITTED",
      actor: "system",
      title: input.successTitle,
      detail: input.successDetail,
    });
    return "auto_submitted" as const;
  }

  if (!result.success && result.manualActionType) {
    await updateApplicationAfterAutomation({
      applicationId: input.applicationId,
      status: "NEEDS_USER_ACTION",
      blockingReason: result.blockingReason ?? result.error ?? "Manual action required.",
      manualActionType: result.manualActionType.toUpperCase() as never,
      lastAutomationUrl: result.currentUrl ?? result.applyUrl,
      autoSubmittedAt: null,
      submittedAt: null,
      needsUserActionAt: new Date(),
      automationSession: {
        checkpoint: result.checkpoint,
        checkpointArtifacts: result.checkpointArtifacts,
        preparedPayload: result.preparedPayload,
        unknownRequiredFields: result.unknownRequiredFields,
        missingProfileFields: result.missingProfileFields,
        filledFields: result.filledFields,
      },
    });
    await recordApplicationEvent({
      applicationId: input.applicationId,
      type: "NEEDS_USER_ACTION",
      actor: "system",
      title: "Manual action required",
      detail: result.blockingReason ?? result.error ?? "The automation flow paused on friction or uncertainty.",
    });
    await createNotification({
      userId: input.userId,
      applicationId: input.applicationId,
      type: "ACTION_REQUIRED",
      title: `${input.company} needs your input`,
      body: result.blockingReason ?? "The application flow paused and saved its prepared state.",
      actionUrl: "/applications",
      metadata: {
        checkpointArtifacts: result.checkpointArtifacts,
        currentUrl: result.currentUrl,
      },
    });
    return "needs_user_action" as const;
  }

  await updateApplicationAfterAutomation({
    applicationId: input.applicationId,
    status: "PREPARED",
    blockingReason: null,
    manualActionType: null,
    lastAutomationUrl: result.currentUrl ?? result.applyUrl,
    autoSubmittedAt: null,
    submittedAt: null,
    needsUserActionAt: null,
    automationSession: {
      preparedPayload: result.preparedPayload,
      filledFields: result.filledFields,
      unknownRequiredFields: result.unknownRequiredFields,
      missingProfileFields: result.missingProfileFields,
      dryRun: result.dryRun,
      error: result.error,
    },
  });

  await recordApplicationEvent({
    applicationId: input.applicationId,
    type: "NOTE",
    actor: "system",
    title: "Autofill attempt finished without submission",
    detail: result.error ?? "The autofill run did not reach a confirmation state.",
  });

  return "prepared" as const;
}

function extractStructuredDefaults(
  context: NonNullable<Awaited<ReturnType<typeof getApplicationAutomationContext>>>,
) {
  const profile = toStructuredProfile(context.user as Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>[number]);
  const preferences = toJobPreferences(context.user as Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>[number]);
  const preparedPayload = isRecord(context.preparedPayload) ? context.preparedPayload : null;
  const tailoredResume = isRecord(preparedPayload?.tailoredResume) ? preparedPayload.tailoredResume : null;

  return buildStructuredApplicationDefaults({
    profile,
    preferences,
    tailoredResume: tailoredResume
      ? {
        summaryLine: typeof tailoredResume.summaryLine === "string" ? tailoredResume.summaryLine : "",
        tailoredBullets: Array.isArray(tailoredResume.tailoredBullets)
          ? tailoredResume.tailoredBullets.filter((item): item is string => typeof item === "string")
          : [],
        keywordHighlights: Array.isArray(tailoredResume.keywordHighlights)
          ? tailoredResume.keywordHighlights.filter((item): item is string => typeof item === "string")
          : [],
      }
      : null,
    generatedAnswers: context.generatedAnswers.map((answer) => ({
      kind: answer.kind.toLowerCase() as GeneratedAnswer["kind"],
      question: answer.questionText,
      answer: answer.answerText,
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
