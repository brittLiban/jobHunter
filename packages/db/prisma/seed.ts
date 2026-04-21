import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  AccountProvider,
  ApplicationEventType,
  ApplicationStatus,
  GeneratedAnswerKind,
  JobSourceKind,
  NotificationStatus,
  NotificationType,
  PromptTaskKind,
  PromptTemplateScope,
  TailoredDocumentKind,
  WorkMode,
} from "@prisma/client";
import { createPrismaClient } from "../src/client";

const prisma = createPrismaClient();
const DEMO_ONBOARDING_COMPLETED_AT = new Date("2026-04-01T12:00:00.000Z");
const DEMO_RESUME_STORAGE_KEY = "resumes/demo/software-engineer-base.pdf";

async function main(): Promise<void> {
  if (process.env.JOBHUNTER_ENABLE_DEMO_SEED !== "true") {
    console.log("Skipping demo seed. Set JOBHUNTER_ENABLE_DEMO_SEED=true to load demo data.");
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: "demo@jobhunter.local" },
    update: {
      fullName: "Demo Candidate",
      onboardingCompletedAt: DEMO_ONBOARDING_COMPLETED_AT,
    },
    create: {
      email: "demo@jobhunter.local",
      fullName: "Demo Candidate",
      passwordHash: "demo-password-hash",
      onboardingCompletedAt: DEMO_ONBOARDING_COMPLETED_AT,
      accounts: {
        create: {
          provider: AccountProvider.CREDENTIALS,
          providerAccountId: "demo@jobhunter.local",
        },
      },
    },
  });

  await ensureDemoResumeFile();

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      fullLegalName: "Demo Candidate",
      phone: "206-555-0182",
      city: "Seattle",
      state: "WA",
      country: "United States",
      linkedinUrl: "https://www.linkedin.com/in/demo-candidate",
      githubUrl: "https://github.com/demo-candidate",
      portfolioUrl: "https://demo-candidate.dev",
      workAuthorization: "Authorized to work in the United States",
      usCitizenStatus: "U.S. Citizen",
      requiresVisaSponsorship: false,
      veteranStatus: "Not a protected veteran",
      disabilityStatus: "Decline to self-identify",
      school: "Green River College",
      degree: "B.S. Software Development",
      yearsOfExperience: 3,
      currentCompany: "GE Vernova",
      currentTitle: "Software Engineering Intern",
      summary: "Backend-focused software engineer with enterprise integration, automation, and cloud delivery experience.",
    },
    create: {
      userId: user.id,
      fullLegalName: "Demo Candidate",
      phone: "206-555-0182",
      city: "Seattle",
      state: "WA",
      country: "United States",
      linkedinUrl: "https://www.linkedin.com/in/demo-candidate",
      githubUrl: "https://github.com/demo-candidate",
      portfolioUrl: "https://demo-candidate.dev",
      workAuthorization: "Authorized to work in the United States",
      usCitizenStatus: "U.S. Citizen",
      requiresVisaSponsorship: false,
      veteranStatus: "Not a protected veteran",
      disabilityStatus: "Decline to self-identify",
      school: "Green River College",
      degree: "B.S. Software Development",
      yearsOfExperience: 3,
      currentCompany: "GE Vernova",
      currentTitle: "Software Engineering Intern",
      summary: "Backend-focused software engineer with enterprise integration, automation, and cloud delivery experience.",
    },
  });

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: {
      targetRoles: ["software engineer", "backend engineer", "platform engineer"],
      targetLocations: ["Remote", "Seattle, WA", "Bellevue, WA"],
      workModes: [WorkMode.REMOTE, WorkMode.HYBRID],
      salaryFloor: 110000,
      fitThreshold: 70,
      dailyTargetVolume: 12,
      includeKeywords: ["TypeScript", "Python", "APIs", "automation"],
      excludeKeywords: ["staff", "principal", "manager"],
      sourceKinds: [JobSourceKind.MOCK, JobSourceKind.GREENHOUSE, JobSourceKind.ASHBY],
    },
    create: {
      userId: user.id,
      targetRoles: ["software engineer", "backend engineer", "platform engineer"],
      targetLocations: ["Remote", "Seattle, WA", "Bellevue, WA"],
      workModes: [WorkMode.REMOTE, WorkMode.HYBRID],
      salaryFloor: 110000,
      fitThreshold: 70,
      dailyTargetVolume: 12,
      includeKeywords: ["TypeScript", "Python", "APIs", "automation"],
      excludeKeywords: ["staff", "principal", "manager"],
      sourceKinds: [JobSourceKind.MOCK, JobSourceKind.GREENHOUSE, JobSourceKind.ASHBY],
    },
  });

  const resume = await prisma.resume.upsert({
    where: { id: "demo_resume_default" },
    update: {
      label: "Software Engineer Base Resume",
      baseText: "Software engineer with backend, automation, and cloud deployment experience.",
      storageKey: DEMO_RESUME_STORAGE_KEY,
      isDefault: true,
    },
    create: {
      id: "demo_resume_default",
      userId: user.id,
      label: "Software Engineer Base Resume",
      originalFileName: "demo-software-engineer.pdf",
      mimeType: "application/pdf",
      storageKey: DEMO_RESUME_STORAGE_KEY,
      baseText: "Software engineer with backend, automation, and cloud deployment experience.",
      isDefault: true,
    },
  });

  const mockSource = await prisma.jobSource.upsert({
    where: { slug: "mock-demo-feed" },
    update: {
      name: "Mock Demo Feed",
      kind: JobSourceKind.MOCK,
      baseUrl: "https://mock.jobhunter.local",
      configuration: { seeded: true },
      isEnabled: true,
    },
    create: {
      slug: "mock-demo-feed",
      name: "Mock Demo Feed",
      kind: JobSourceKind.MOCK,
      baseUrl: "https://mock.jobhunter.local",
      configuration: { seeded: true },
      isEnabled: true,
    },
  });

  const jobs = await Promise.all(
    [
      {
        key: "vercel-integrations",
        company: "Vercel",
        title: "Software Engineer, Integrations",
        locationText: "Remote - United States",
        canonicalUrl: "https://mock.jobhunter.local/jobs/vercel-integrations",
        applyUrl: "https://mock.jobhunter.local/apply/vercel-integrations",
        descriptionText: "Build APIs, integrations, and internal tooling for developer workflows.",
        score: 91,
        decision: true,
        confidence: 0.93,
        status: ApplicationStatus.AUTO_SUBMITTED,
      },
      {
        key: "figma-backend",
        company: "Figma",
        title: "Backend Engineer",
        locationText: "Seattle, WA",
        canonicalUrl: "https://mock.jobhunter.local/jobs/figma-backend",
        applyUrl: "https://mock.jobhunter.local/apply/figma-backend",
        descriptionText: "Own backend services, APIs, and platform reliability for collaborative product experiences.",
        score: 88,
        decision: true,
        confidence: 0.9,
        status: ApplicationStatus.PREPARED,
      },
      {
        key: "stripe-new-grad",
        company: "Stripe",
        title: "Software Engineer, New Grad",
        locationText: "Remote within U.S.",
        canonicalUrl: "https://mock.jobhunter.local/jobs/stripe-new-grad",
        applyUrl: "https://mock.jobhunter.local/apply/stripe-new-grad",
        descriptionText: "Ship internal and external product systems with strong ownership and engineering rigor.",
        score: 84,
        decision: true,
        confidence: 0.81,
        status: ApplicationStatus.NEEDS_USER_ACTION,
      },
    ].map(async (item) =>
      prisma.job.upsert({
        where: { canonicalUrl: item.canonicalUrl },
        update: {
          sourceId: mockSource.id,
          applyUrl: item.applyUrl,
          company: item.company,
          title: item.title,
          locationText: item.locationText,
          workMode: WorkMode.REMOTE,
          descriptionText: item.descriptionText,
          rawPayload: { seeded: true, key: item.key },
          lastSeenAt: new Date(),
        },
        create: {
          sourceId: mockSource.id,
          externalId: item.key,
          canonicalUrl: item.canonicalUrl,
          applyUrl: item.applyUrl,
          company: item.company,
          title: item.title,
          locationText: item.locationText,
          workMode: WorkMode.REMOTE,
          descriptionText: item.descriptionText,
          rawPayload: { seeded: true, key: item.key },
        },
      }),
    ),
  );

  for (const [index, job] of jobs.entries()) {
    const scoreValues = [
      {
        fitScore: 91,
        decision: true,
        confidence: 0.93,
        topMatches: ["API design", "workflow automation", "developer tooling"],
        majorGaps: ["No direct Vercel product experience"],
      },
      {
        fitScore: 88,
        decision: true,
        confidence: 0.9,
        topMatches: ["backend systems", "service integrations", "cloud deployment"],
        majorGaps: ["Less experience with collaboration products"],
      },
      {
        fitScore: 84,
        decision: true,
        confidence: 0.81,
        topMatches: ["production software delivery", "automation", "cross-functional work"],
        majorGaps: ["Limited large-scale fintech domain exposure"],
      },
    ][index];

    const score = await prisma.jobScore.upsert({
      where: {
        userId_jobId: {
          userId: user.id,
          jobId: job.id,
        },
      },
      update: {
        fitScore: scoreValues.fitScore,
        decision: scoreValues.decision,
        confidence: scoreValues.confidence,
        topMatches: scoreValues.topMatches,
        majorGaps: scoreValues.majorGaps,
        weightedBreakdown: {
          skillOverlap: scoreValues.fitScore - 3,
          techStackOverlap: scoreValues.fitScore - 5,
          roleAlignment: scoreValues.fitScore - 1,
          experienceLevelMatch: scoreValues.fitScore - 7,
          locationAndAuthorizationFit: 100,
        },
        ruleBreakdown: {
          fitThresholdPassed: true,
          locationPassed: true,
          workAuthorizationPassed: true,
        },
      },
      create: {
        userId: user.id,
        jobId: job.id,
        fitScore: scoreValues.fitScore,
        decision: scoreValues.decision,
        confidence: scoreValues.confidence,
        topMatches: scoreValues.topMatches,
        majorGaps: scoreValues.majorGaps,
        weightedBreakdown: {
          skillOverlap: scoreValues.fitScore - 3,
          techStackOverlap: scoreValues.fitScore - 5,
          roleAlignment: scoreValues.fitScore - 1,
          experienceLevelMatch: scoreValues.fitScore - 7,
          locationAndAuthorizationFit: 100,
        },
        ruleBreakdown: {
          fitThresholdPassed: true,
          locationPassed: true,
          workAuthorizationPassed: true,
        },
      },
    });

    const status = [
      ApplicationStatus.AUTO_SUBMITTED,
      ApplicationStatus.PREPARED,
      ApplicationStatus.NEEDS_USER_ACTION,
    ][index];

    const application = await prisma.application.upsert({
      where: {
        userId_jobId: {
          userId: user.id,
          jobId: job.id,
        },
      },
      update: {
        sourceId: mockSource.id,
        resumeId: resume.id,
        scoreId: score.id,
        fitScoreSnapshot: score.fitScore,
        fitThresholdSnapshot: 70,
        status,
        simpleFlowConfirmed: status !== ApplicationStatus.NEEDS_USER_ACTION,
        highConfidence: score.confidence >= 0.8,
        blockingReason:
          status === ApplicationStatus.NEEDS_USER_ACTION
            ? "Verification step interrupted auto-submit flow."
            : null,
        preparedAt: new Date(),
        autoSubmittedAt:
          status === ApplicationStatus.AUTO_SUBMITTED ? new Date() : null,
        needsUserActionAt:
          status === ApplicationStatus.NEEDS_USER_ACTION ? new Date() : null,
      },
      create: {
        userId: user.id,
        jobId: job.id,
        sourceId: mockSource.id,
        resumeId: resume.id,
        scoreId: score.id,
        fitScoreSnapshot: score.fitScore,
        fitThresholdSnapshot: 70,
        status,
        simpleFlowConfirmed: status !== ApplicationStatus.NEEDS_USER_ACTION,
        highConfidence: score.confidence >= 0.8,
        blockingReason:
          status === ApplicationStatus.NEEDS_USER_ACTION
            ? "Verification step interrupted auto-submit flow."
            : null,
        preparedAt: new Date(),
        autoSubmittedAt:
          status === ApplicationStatus.AUTO_SUBMITTED ? new Date() : null,
        needsUserActionAt:
          status === ApplicationStatus.NEEDS_USER_ACTION ? new Date() : null,
      },
    });

    await prisma.resumeVersion.upsert({
      where: { id: `seed_resume_version_${index + 1}` },
      update: {
        applicationId: application.id,
        label: `${job.company} tailored resume`,
        contentText: `Tailored resume draft for ${job.title} at ${job.company}.`,
      },
      create: {
        id: `seed_resume_version_${index + 1}`,
        resumeId: resume.id,
        applicationId: application.id,
        label: `${job.company} tailored resume`,
        contentText: `Tailored resume draft for ${job.title} at ${job.company}.`,
      },
    });

    await prisma.tailoredDocument.upsert({
      where: { id: `seed_tailored_document_${index + 1}` },
      update: {
        userId: user.id,
        jobId: job.id,
        applicationId: application.id,
        resumeId: resume.id,
        kind: TailoredDocumentKind.RESUME,
        title: `${job.company} application packet`,
        contentText: `Tailored summary and bullets for ${job.title}.`,
        contentJson: {
          summaryLine: "Backend engineer who ships reliable automations and APIs.",
          tailoredBullets: [
            "Built automation workflows that reduced repetitive manual operations.",
            "Designed backend services and integrations for production business systems.",
            "Improved delivery reliability with testing, debugging, and CI/CD discipline.",
          ],
        },
      },
      create: {
        id: `seed_tailored_document_${index + 1}`,
        userId: user.id,
        jobId: job.id,
        applicationId: application.id,
        resumeId: resume.id,
        kind: TailoredDocumentKind.RESUME,
        title: `${job.company} application packet`,
        contentText: `Tailored summary and bullets for ${job.title}.`,
        contentJson: {
          summaryLine: "Backend engineer who ships reliable automations and APIs.",
          tailoredBullets: [
            "Built automation workflows that reduced repetitive manual operations.",
            "Designed backend services and integrations for production business systems.",
            "Improved delivery reliability with testing, debugging, and CI/CD discipline.",
          ],
        },
      },
    });

    await prisma.generatedAnswer.upsert({
      where: { id: `seed_generated_answer_${index + 1}` },
      update: {
        userId: user.id,
        jobId: job.id,
        applicationId: application.id,
        kind: GeneratedAnswerKind.WHY_ROLE,
        questionText: "Why are you interested in this role?",
        answerText: `This ${job.title} role matches my background in backend systems, automation, and shipping production features.`,
        variationVerb: ["built", "designed", "improved"][index],
        variationOpening: ["I bring", "My background includes", "This role stands out because"][index],
        fingerprint: `${job.company.toLowerCase()}-why-role`,
      },
      create: {
        id: `seed_generated_answer_${index + 1}`,
        userId: user.id,
        jobId: job.id,
        applicationId: application.id,
        kind: GeneratedAnswerKind.WHY_ROLE,
        questionText: "Why are you interested in this role?",
        answerText: `This ${job.title} role matches my background in backend systems, automation, and shipping production features.`,
        variationVerb: ["built", "designed", "improved"][index],
        variationOpening: ["I bring", "My background includes", "This role stands out because"][index],
        fingerprint: `${job.company.toLowerCase()}-why-role`,
      },
    });

    await prisma.applicationEvent.upsert({
      where: { id: `seed_application_event_${index + 1}` },
      update: {
        applicationId: application.id,
        type:
          status === ApplicationStatus.AUTO_SUBMITTED
            ? ApplicationEventType.AUTO_SUBMITTED
            : status === ApplicationStatus.NEEDS_USER_ACTION
              ? ApplicationEventType.NEEDS_USER_ACTION
              : ApplicationEventType.PREPARED,
        actor: "system",
        title:
          status === ApplicationStatus.AUTO_SUBMITTED
            ? "Application auto-submitted"
            : status === ApplicationStatus.NEEDS_USER_ACTION
              ? "Application paused for user action"
              : "Application prepared",
        detail:
          status === ApplicationStatus.NEEDS_USER_ACTION
            ? "Verification or uncertainty interrupted the flow. Resume and answers are saved."
            : "The system prepared the application packet and updated the dashboard.",
        metadata: {
          seeded: true,
          fitScore: score.fitScore,
        },
      },
      create: {
        id: `seed_application_event_${index + 1}`,
        applicationId: application.id,
        type:
          status === ApplicationStatus.AUTO_SUBMITTED
            ? ApplicationEventType.AUTO_SUBMITTED
            : status === ApplicationStatus.NEEDS_USER_ACTION
              ? ApplicationEventType.NEEDS_USER_ACTION
              : ApplicationEventType.PREPARED,
        actor: "system",
        title:
          status === ApplicationStatus.AUTO_SUBMITTED
            ? "Application auto-submitted"
            : status === ApplicationStatus.NEEDS_USER_ACTION
              ? "Application paused for user action"
              : "Application prepared",
        detail:
          status === ApplicationStatus.NEEDS_USER_ACTION
            ? "Verification or uncertainty interrupted the flow. Resume and answers are saved."
            : "The system prepared the application packet and updated the dashboard.",
        metadata: {
          seeded: true,
          fitScore: score.fitScore,
        },
      },
    });
  }

  await prisma.notification.upsert({
    where: { id: "seed_notification_1" },
    update: {
      userId: user.id,
      type: NotificationType.ACTION_REQUIRED,
      status: NotificationStatus.UNREAD,
      title: "Stripe needs your input",
      body: "A verification step blocked autonomous submission. Resume and prepared answers are ready to resume.",
      actionUrl: "/applications",
      metadata: { seeded: true },
    },
    create: {
      id: "seed_notification_1",
      userId: user.id,
      type: NotificationType.ACTION_REQUIRED,
      status: NotificationStatus.UNREAD,
      title: "Stripe needs your input",
      body: "A verification step blocked autonomous submission. Resume and prepared answers are ready to resume.",
      actionUrl: "/applications",
      metadata: { seeded: true },
    },
  });

  await Promise.all(
    [
      {
        id: "seed_prompt_template_scorer",
        name: "Default Job Scorer",
        taskKind: PromptTaskKind.JOB_SCORER,
        systemPrompt: "Score fit using weighted evidence and never override hard business rules.",
        userPrompt: "Compare the job description against the structured user profile and base resume.",
      },
      {
        id: "seed_prompt_template_tailor",
        name: "Default Resume Tailor",
        taskKind: PromptTaskKind.RESUME_TAILOR,
        systemPrompt: "Rewrite only with truthful evidence from the resume. Never invent experience.",
        userPrompt: "Tailor the summary and two to four bullets for the job.",
      },
      {
        id: "seed_prompt_template_answers",
        name: "Default Short Answer Generator",
        taskKind: PromptTaskKind.SHORT_ANSWER_GENERATOR,
        systemPrompt: "Produce concise, credible, non-repetitive short-form application answers.",
        userPrompt: "Generate why-role, why-fit, and optional closing answers without repeating phrasing.",
      },
    ].map(({ id, ...template }) =>
      prisma.promptTemplate.upsert({
        where: { id },
        update: {
          ...template,
          scope: PromptTemplateScope.GLOBAL,
          isActive: true,
          userId: null,
          sourceId: null,
          version: 1,
        },
        create: {
          id,
          ...template,
          scope: PromptTemplateScope.GLOBAL,
          isActive: true,
          version: 1,
        },
      }),
    ),
  );
}

async function ensureDemoResumeFile() {
  const resumePath = resolve(process.cwd(), "..", "..", "data", DEMO_RESUME_STORAGE_KEY);
  await mkdir(dirname(resumePath), { recursive: true });
  await writeFile(
    resumePath,
    [
      "%PDF-1.4",
      "% JobHunter demo resume placeholder",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj",
      "4 0 obj << /Length 49 >> stream",
      "BT /F1 12 Tf 72 720 Td (JobHunter Demo Resume) Tj ET",
      "endstream endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
      "",
    ].join("\n"),
    "utf8",
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
