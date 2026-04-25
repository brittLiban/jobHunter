import { applyToGreenhouseJob, applyToMockJob } from "@jobhunter/automation";
import {
  buildStructuredApplicationDefaults,
  evaluateDiscoveryControls,
  evaluateJobRules,
  isWithinDailyVolumeWindow,
  meetsFitThreshold,
  resolveDataPath,
  type FitAssessment,
  type GeneratedAnswer,
  type JobPosting,
  type JobPreferences,
  type StructuredApplicationDefaults,
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
import { buildDefaultSourceTargetsFromEnv, buildSourceTargetsFromBoards, discoverJobsForTargets } from "@jobhunter/job-sources";
import {
  ApplicationFieldAnswerSuggesterService,
  JobScorerService,
  JobSeniorityClassifierService,
  ResumeTailorService,
  ShortAnswerGeneratorService,
  createLLMProviderFromConfig,
  type LLMConfig,
} from "@jobhunter/llm";

type PipelineOptions = {
  onlyUserId?: string;
  boardFilter?: { source: string; slug: string };
};

type ExistingApplicationSummary = Awaited<ReturnType<typeof getExistingApplicationsForUser>>[number];

type EligibleJobCandidate = {
  persistedJob: Awaited<ReturnType<typeof upsertDiscoveredJob>>;
  job: JobPosting;
  persistedScore: Awaited<ReturnType<typeof upsertUserScore>>;
  score: FitAssessment;
  ruleEvaluation: ReturnType<typeof evaluateJobRules>;
  existingApplication?: ExistingApplicationSummary;
};

const DAILY_TARGET_QUEUE_REASON =
  "Daily target volume was reached, so this application is queued until another preparation slot opens.";

export async function runPipeline(options: PipelineOptions = {}) {
  const users = (await getOnboardedUsersForPipeline()).filter(
    (user) => !options.onlyUserId || user.id === options.onlyUserId,
  );
  const activeUsers = users.filter((user) => user.profile && user.preferences && user.resumes.length > 0);
  const enabledSourceKinds = new Set(
    activeUsers.flatMap((user) =>
      (user.preferences?.sourceKinds ?? ["MOCK", "GREENHOUSE", "ASHBY", "LEVER", "WORKABLE"]).map((kind) => kind.toLowerCase()),
    ),
  );

  // Merge per-user board lists or fall back to env-var defaults
  const mergedBoards = mergeUserBoards(activeUsers);
  let sourceTargets = (mergedBoards
    ? buildSourceTargetsFromBoards(mergedBoards)
    : buildDefaultSourceTargetsFromEnv()
  ).filter((target) => enabledSourceKinds.has(target.kind));

  // If a specific board was requested, narrow to that single target
  if (options.boardFilter) {
    const { source, slug } = options.boardFilter;
    sourceTargets = sourceTargets
      .filter((t) => t.kind === source)
      .map((t) => ({
        ...t,
        identifiers: t.identifiers.filter((id) => id.slug === slug),
      }))
      .filter((t) => t.identifiers.length > 0);

    // If the slug wasn't in the merged list, inject it directly
    if (sourceTargets.length === 0) {
      sourceTargets = [{
        kind: source as never,
        sourceName: `${source} (${slug})`,
        identifiers: [{ slug }],
      }];
    }
  }

  // Use first active user's LLM config, falling back to env vars
  const primaryLlmConfig = resolveUserLlmConfig(activeUsers[0]);
  const llmProvider = createLLMProviderFromConfig(primaryLlmConfig);
  const scorer = new JobScorerService(llmProvider);
  const seniorityClassifier = new JobSeniorityClassifierService();
  const tailor = new ResumeTailorService(llmProvider);
  const answerGenerator = new ShortAnswerGeneratorService(llmProvider);

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
    (await Promise.all(
      jobs.map(async (job) => {
        const seniorityAssessment = await seniorityClassifier.classify({ job });
        const enrichedJob: JobPosting = {
          ...job,
          seniority: seniorityAssessment.level,
          seniorityConfidence: seniorityAssessment.confidence,
        };

        const matchesAtLeastOneUser = activeUsers.some((user) =>
          evaluateDiscoveryControls({
            job: enrichedJob,
            preferences: toJobPreferences(user),
            profile: toStructuredProfile(user),
          }).passed,
        );

        if (!matchesAtLeastOneUser) {
          return null;
        }

        return upsertDiscoveredJob({
          sourceId: jobsBySourceKind.get(job.sourceKind)?.id ?? sourceRecords[0].id,
          job: enrichedJob,
          rawPayload: {
            ...job,
            seniorityAssessment,
          },
          seniorityAssessment,
        });
      }),
    )).filter((job): job is NonNullable<typeof job> => job !== null),
  );

  const results = {
    discoveredJobs: persistedJobs.length,
    processedUsers: users.length,
    scoredApplications: 0,
    queuedApplications: 0,
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
    const eligibleCandidates: EligibleJobCandidate[] = [];
    let remainingDailyCapacity = Math.max(
      preferences.dailyTargetVolume
      - existingApplications.filter((application) => isWithinDailyVolumeWindow(application.preparedAt)).length,
      0,
    );

    for (const persistedJob of persistedJobs) {
      const sourceRecord = sourceRecords.find((source) => source.id === persistedJob.sourceId);
      const existingApplication = existingApplicationsByJobId.get(persistedJob.id);
      if (existingApplication && shouldPreserveApplicationStatus(existingApplication.status)) {
        continue;
      }

      const job: JobPosting = {
        id: persistedJob.id,
        externalId: persistedJob.externalId ?? undefined,
        sourceKind: (sourceRecord?.kind.toLowerCase() ?? "mock") as JobPosting["sourceKind"],
        sourceName: sourceRecord?.name ?? "Unknown Source",
        company: persistedJob.company,
        title: persistedJob.title,
        location: persistedJob.locationText ?? "",
        seniority: persistedJob.seniorityLevel ? (persistedJob.seniorityLevel.toLowerCase() as JobPosting["seniority"]) : undefined,
        seniorityConfidence: persistedJob.seniorityConfidence ?? undefined,
        workMode: persistedJob.workMode ? (persistedJob.workMode.toLowerCase() as "remote" | "hybrid" | "on_site" | "flexible") : undefined,
        salaryMin: persistedJob.salaryMin ?? undefined,
        salaryMax: persistedJob.salaryMax ?? undefined,
        salaryCurrency: persistedJob.salaryCurrency ?? "USD",
        description: persistedJob.descriptionText,
        url: persistedJob.canonicalUrl,
        applyUrl: persistedJob.applyUrl ?? undefined,
        discoveredAt: persistedJob.discoveredAt.toISOString(),
      };

      const discoveryEvaluation = evaluateDiscoveryControls({
        job,
        preferences,
        profile,
      });
      if (!discoveryEvaluation.passed) {
        continue;
      }

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

      eligibleCandidates.push({
        persistedJob,
        job,
        persistedScore,
        score,
        ruleEvaluation,
        existingApplication,
      });
    }

    for (const candidate of eligibleCandidates.sort(compareEligibleJobCandidates)) {
      if (remainingDailyCapacity <= 0) {
        const application = await ensureQueuedApplication({
          userId: user.id,
          resumeId: resume.id,
          fitThreshold: preferences.fitThreshold,
          candidate,
        });

        if (candidate.existingApplication?.status !== "QUEUED") {
          await recordApplicationEvent({
            applicationId: application.id,
            type: "QUEUED",
            actor: "system",
            title: "Application queued",
            detail: DAILY_TARGET_QUEUE_REASON,
            metadata: {
              fitScore: candidate.score.fitScore,
              dailyTargetVolume: preferences.dailyTargetVolume,
            },
          });
        }

        results.queuedApplications += 1;
        existingApplicationsByJobId.set(candidate.persistedJob.id, {
          id: application.id,
          jobId: application.jobId,
          status: application.status,
          preparedAt: application.preparedAt,
        });
        continue;
      }

      const prepared = await prepareEligibleApplication({
        userId: user.id,
        resumeId: resume.id,
        resumeText: resume.baseText,
        resumePath,
        profile,
        preferences,
        candidate,
        tailor,
        answerGenerator,
      });

      results.preparedApplications += 1;
      remainingDailyCapacity -= 1;
      existingApplicationsByJobId.set(candidate.persistedJob.id, {
        id: prepared.application.id,
        jobId: prepared.application.jobId,
        status: prepared.application.status,
        preparedAt: prepared.application.preparedAt,
      });

      if (!autoApplyEnabled() || !isGreenhouseFlow(prepared.candidate.job.applyUrl ?? prepared.candidate.job.url)) {
        continue;
      }

      const result = await applyToGreenhouseJob({
        jobUrl: prepared.candidate.job.applyUrl ?? prepared.candidate.job.url,
        defaults: prepared.structuredDefaults,
        resumePath,
        generatedAnswers: prepared.generatedAnswers.items as GeneratedAnswer[],
        applicationId: prepared.application.id,
        dryRun: autoApplyDryRun(),
      });
      const outcome = await persistAutomationOutcome({
        userId: user.id,
        applicationId: prepared.application.id,
        company: prepared.candidate.job.company,
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
  const fieldOverrides = extractFieldOverrides(context);
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
      fieldOverrides,
      resumePath,
      generatedAnswers,
      applicationId: context.id,
      dryRun: false,
    })
    : await applyToGreenhouseJob({
      jobUrl: applyTarget,
      defaults: structuredDefaults,
      fieldOverrides,
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
    redirectUrl: result.currentUrl ?? result.applyUrl ?? applyTarget,
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
  const seniorityTargets = user.preferences?.seniorityTargets.map((level) => level.toLowerCase()) ?? [];
  const sourceKinds = user.preferences?.sourceKinds.map((kind) => kind.toLowerCase()) ?? [];

  return {
    targetRoles: user.preferences?.targetRoles ?? ["software engineer"],
    locations: user.preferences?.targetLocations ?? ["Remote"],
    workModes: (user.preferences?.workModes.map((mode) => mode.toLowerCase()) ?? ["remote"]) as JobPreferences["workModes"],
    seniorityTargets: (seniorityTargets.length > 0 ? seniorityTargets : ["entry", "mid"]) as JobPreferences["seniorityTargets"],
    salaryFloor: user.preferences?.salaryFloor ?? undefined,
    fitThreshold: user.preferences?.fitThreshold ?? 70,
    dailyTargetVolume: user.preferences?.dailyTargetVolume ?? 15,
    includeKeywords: user.preferences?.includeKeywords ?? [],
    excludeKeywords: user.preferences?.excludeKeywords ?? [],
    sourceKinds: (sourceKinds.length > 0 ? sourceKinds : ["greenhouse", "ashby", "lever", "workable", "mock"]) as JobPreferences["sourceKinds"],
    greenhouseBoards: [],
    ashbyBoards: [],
    leverBoards: [],
    workableBoards: [],
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
  try {
    const parsed = new URL(url);
    return parsed.host.includes("greenhouse") || parsed.searchParams.has("gh_jid");
  } catch {
    return url.includes("greenhouse") || url.includes("gh_jid=");
  }
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
    "PREPARED",
    "NEEDS_USER_ACTION",
    "AUTO_SUBMITTED",
    "SUBMITTED",
    "RESPONDED",
    "INTERVIEW",
    "REJECTED",
    "OFFER",
  ].includes(status);
}

async function ensureQueuedApplication(input: {
  userId: string;
  resumeId: string;
  fitThreshold: number;
  candidate: EligibleJobCandidate;
}) {
  return ensureApplicationRecord({
    userId: input.userId,
    jobId: input.candidate.persistedJob.id,
    sourceId: input.candidate.persistedJob.sourceId,
    resumeId: input.resumeId,
    scoreId: input.candidate.persistedScore.id,
    fitScoreSnapshot: input.candidate.score.fitScore,
    fitThresholdSnapshot: input.fitThreshold,
    status: "QUEUED",
    simpleFlowConfirmed: isSimpleFlow(input.candidate.job.url),
    highConfidence: input.candidate.score.confidence >= 0.8,
    preparedPayload: {
      score: input.candidate.score,
      ruleEvaluation: input.candidate.ruleEvaluation,
      queuedReason: DAILY_TARGET_QUEUE_REASON,
    },
    automationSession: null,
    preparedAt: null,
    autoSubmittedAt: null,
    submittedAt: null,
    needsUserActionAt: null,
  });
}

async function prepareEligibleApplication(input: {
  userId: string;
  resumeId: string;
  resumeText: string;
  resumePath: string;
  profile: StructuredProfile;
  preferences: JobPreferences;
  candidate: EligibleJobCandidate;
  tailor: ResumeTailorService;
  answerGenerator: ShortAnswerGeneratorService;
}) {
  const tailoredResume = await input.tailor.tailor({
    job: input.candidate.job,
    resumeText: input.resumeText,
  });
  const generatedAnswers = await input.answerGenerator.generate({
    job: input.candidate.job,
    profile: input.profile,
    tailoredResume,
  });

  const structuredDefaults = buildStructuredApplicationDefaults({
    profile: input.profile,
    preferences: input.preferences,
    tailoredResume,
    generatedAnswers: generatedAnswers.items as GeneratedAnswer[],
  });

  const application = await ensureApplicationRecord({
    userId: input.userId,
    jobId: input.candidate.persistedJob.id,
    sourceId: input.candidate.persistedJob.sourceId,
    resumeId: input.resumeId,
    scoreId: input.candidate.persistedScore.id,
    fitScoreSnapshot: input.candidate.score.fitScore,
    fitThresholdSnapshot: input.preferences.fitThreshold,
    status: "PREPARED",
    simpleFlowConfirmed: isSimpleFlow(input.candidate.job.url),
    highConfidence: input.candidate.score.confidence >= 0.8,
    preparedPayload: {
      structuredDefaults,
      generatedAnswers,
      tailoredResume,
      resumePath: input.resumePath,
    },
    automationSession: null,
    preparedAt: new Date(),
    autoSubmittedAt: null,
    submittedAt: null,
    needsUserActionAt: null,
  });

  await replaceTailoredArtifacts({
    applicationId: application.id,
    userId: input.userId,
    jobId: input.candidate.persistedJob.id,
    resumeId: input.resumeId,
    tailoredResume,
    generatedAnswers,
  });

  await recordApplicationEvent({
    applicationId: application.id,
    type: "PREPARED",
    actor: "system",
    title: "Application prepared",
    detail: input.candidate.existingApplication?.status === "QUEUED"
      ? "A daily target slot opened, so the queued job was prepared with structured profile fields and tailored materials."
      : "Structured profile fields, tailored resume content, and generated answers were saved.",
    metadata: {
      fitScore: input.candidate.score.fitScore,
      confidence: input.candidate.score.confidence,
    },
  });

  return {
    application,
    candidate: input.candidate,
    generatedAnswers,
    structuredDefaults,
  };
}

function compareEligibleJobCandidates(a: EligibleJobCandidate, b: EligibleJobCandidate) {
  const aQueued = a.existingApplication?.status === "QUEUED" ? 1 : 0;
  const bQueued = b.existingApplication?.status === "QUEUED" ? 1 : 0;
  if (aQueued !== bQueued) {
    return bQueued - aQueued;
  }

  if (a.score.fitScore !== b.score.fitScore) {
    return b.score.fitScore - a.score.fitScore;
  }

  if (a.score.confidence !== b.score.confidence) {
    return b.score.confidence - a.score.confidence;
  }

  return new Date(b.job.discoveredAt).getTime() - new Date(a.job.discoveredAt).getTime();
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
    const suggestedFieldAnswers = await buildUnknownFieldSuggestions(result);
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
        suggestedFieldAnswers,
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

async function buildUnknownFieldSuggestions(
  result: Awaited<ReturnType<typeof applyToGreenhouseJob>>,
) {
  const unknownRequiredFields = result.unknownRequiredFields ?? [];
  if (unknownRequiredFields.length === 0) {
    return {} as Record<string, string>;
  }

  const preparedPayload = isRecord(result.preparedPayload) ? result.preparedPayload : null;
  const defaults = coerceStructuredDefaults(preparedPayload?.defaults);
  const generatedAnswers = coerceGeneratedAnswers(preparedPayload?.generatedAnswers);
  const sourceHost = safeHostFromUrl(result.currentUrl ?? result.applyUrl ?? "");
  const existingOverrides = coerceFieldOverrides(preparedPayload?.fieldOverrides);
  const service = new ApplicationFieldAnswerSuggesterService();
  const suggestions: Record<string, string> = {};

  for (const label of unknownRequiredFields) {
    const normalizedLabel = normalizeFieldOverrideKey(label);
    if (existingOverrides[normalizedLabel]) {
      continue;
    }

    const suggested = await service.suggest({
      sourceHost,
      fieldLabel: label,
      defaults,
      generatedAnswers,
    });

    if (suggested.shouldSuggest && suggested.answer.trim()) {
      suggestions[normalizedLabel] = suggested.answer.trim();
    }
  }

  return suggestions;
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

function extractFieldOverrides(
  context: NonNullable<Awaited<ReturnType<typeof getApplicationAutomationContext>>>,
) {
  const preparedPayload = isRecord(context.preparedPayload) ? context.preparedPayload : null;
  const rawOverrides = isRecord(preparedPayload?.fieldOverrides) ? preparedPayload.fieldOverrides : null;
  if (!rawOverrides) {
    return {} as Record<string, string>;
  }

  const entries = Object.entries(rawOverrides)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => [normalizeFieldOverrideKey(key), String(value).trim()] as const)
    .filter(([, value]) => value.length > 0);

  return Object.fromEntries(entries);
}

function normalizeFieldOverrideKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function coerceFieldOverrides(value: unknown) {
  if (!isRecord(value)) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [normalizeFieldOverrideKey(key), String(item).trim()])
      .filter(([, item]) => item.length > 0),
  );
}

function coerceGeneratedAnswers(value: unknown): GeneratedAnswer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
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

function coerceStructuredDefaults(value: unknown): StructuredApplicationDefaults {
  const record = isRecord(value) ? value : {};
  return {
    fullLegalName: readString(record.fullLegalName),
    firstName: readString(record.firstName),
    lastName: readString(record.lastName),
    email: readString(record.email),
    phone: readString(record.phone),
    city: readString(record.city),
    state: readString(record.state),
    country: readString(record.country),
    linkedinUrl: readOptionalString(record.linkedinUrl),
    githubUrl: readOptionalString(record.githubUrl),
    portfolioUrl: readOptionalString(record.portfolioUrl),
    workAuthorization: readString(record.workAuthorization),
    usCitizenStatus: readString(record.usCitizenStatus),
    requiresVisaSponsorship: readYesNo(record.requiresVisaSponsorship),
    veteranStatus: readString(record.veteranStatus),
    disabilityStatus: readOptionalString(record.disabilityStatus),
    school: readString(record.school),
    degree: readString(record.degree),
    graduationDate: readString(record.graduationDate),
    yearsOfExperience: readString(record.yearsOfExperience),
    currentCompany: readString(record.currentCompany),
    currentTitle: readString(record.currentTitle),
    targetLocations: readStringArray(record.targetLocations),
    workModes: readStringArray(record.workModes),
    messagingOptIn: readOptionalYesNo(record.messagingOptIn),
    whyRole: readOptionalString(record.whyRole),
    whyFit: readOptionalString(record.whyFit),
    anythingElse: readOptionalString(record.anythingElse),
    tailoredSummary: readOptionalString(record.tailoredSummary),
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readYesNo(value: unknown): "Yes" | "No" {
  return String(value).trim().toLowerCase() === "yes" ? "Yes" : "No";
}

function readOptionalYesNo(value: unknown): "Yes" | "No" | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "yes") {
    return "Yes";
  }
  if (normalized === "no") {
    return "No";
  }
  return undefined;
}

function safeHostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveUserLlmConfig(
  user: Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>[number] | undefined,
): LLMConfig | null {
  const prefs = user?.preferences as (Record<string, unknown> & {
    llmProvider?: string | null;
    llmModel?: string | null;
    llmBaseUrl?: string | null;
    llmApiKey?: string | null;
  }) | null | undefined;

  if (!prefs?.llmProvider) {
    return null;
  }

  return {
    provider: prefs.llmProvider as LLMConfig["provider"],
    model: prefs.llmModel ?? undefined,
    baseUrl: prefs.llmBaseUrl ?? undefined,
    apiKey: prefs.llmApiKey ?? undefined,
  };
}

function mergeUserBoards(
  users: Awaited<ReturnType<typeof getOnboardedUsersForPipeline>>,
): { greenhouse: string[]; ashby: string[]; lever: string[]; workable: string[] } | null {
  const greenhouse = new Set<string>();
  const ashby = new Set<string>();
  const lever = new Set<string>();
  const workable = new Set<string>();

  let hasBoardConfig = false;

  for (const user of users) {
    const prefs = user.preferences as (typeof user.preferences & {
      greenhouseBoards?: string[];
      ashbyBoards?: string[];
      leverBoards?: string[];
      workableBoards?: string[];
    }) | null | undefined;

    if (!prefs) {
      continue;
    }

    (prefs.greenhouseBoards ?? []).forEach((b) => { greenhouse.add(b); hasBoardConfig = true; });
    (prefs.ashbyBoards ?? []).forEach((b) => { ashby.add(b); hasBoardConfig = true; });
    (prefs.leverBoards ?? []).forEach((b) => { lever.add(b); hasBoardConfig = true; });
    (prefs.workableBoards ?? []).forEach((b) => { workable.add(b); hasBoardConfig = true; });
  }

  if (!hasBoardConfig) {
    return null;
  }

  return {
    greenhouse: [...greenhouse],
    ashby: [...ashby],
    lever: [...lever],
    workable: [...workable],
  };
}
