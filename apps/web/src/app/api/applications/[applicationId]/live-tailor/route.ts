import { getApplicationAutomationContext, replaceTailoredArtifacts } from "@jobhunter/db";
import {
  FormQuestionResolverService,
  ResumeTailorService,
  ShortAnswerGeneratorService,
  createLLMProviderFromConfig,
  type FormQuestion,
  type LLMConfig,
} from "@jobhunter/llm";
import { NextResponse } from "next/server";

import { requireOnboardedUser } from "@/lib/auth";

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const user = await requireOnboardedUser();
  const { applicationId } = await context.params as { applicationId: string };

  const application = await getApplicationAutomationContext(user.id, applicationId);

  if (!application || !application.resume || !application.user.profile) {
    return NextResponse.json(
      { error: "Application context is incomplete." },
      { status: 404 },
    );
  }

  // Parse form questions from request body (sent by the extension's content-script)
  let formQuestions: FormQuestion[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.formQuestions)) {
      formQuestions = body.formQuestions.slice(0, 80); // cap
    }
  } catch {
    // No body or invalid JSON — proceed without questions
  }

  // Build LLM config from user preferences (falls back to env vars if unset)
  const prefs = application.user.preferences;
  const llmConfig: LLMConfig | null = prefs?.llmProvider
    ? {
        provider: prefs.llmProvider.toLowerCase() as "openai" | "ollama" | "anthropic",
        model: prefs.llmModel ?? undefined,
        apiKey: prefs.llmApiKey ?? undefined,
        baseUrl: prefs.llmBaseUrl ?? undefined,
      }
    : null;

  const llm = createLLMProviderFromConfig(llmConfig);
  const tailorService   = new ResumeTailorService(llm);
  const answerService   = new ShortAnswerGeneratorService(llm);
  const questionService = new FormQuestionResolverService(llm);

  const job = {
    id: application.job.id,
    title: application.job.title,
    company: application.job.company,
    description: application.job.description ?? "",
    location: application.job.location ?? "",
    canonicalUrl: application.job.canonicalUrl,
    applyUrl: application.job.applyUrl ?? application.job.canonicalUrl,
    sourceKind: application.job.source.kind.toLowerCase() as "greenhouse" | "ashby" | "lever" | "workable" | "mock" | "company_site" | "extension",
    sourceName: application.job.source.slug,
    salaryMin: application.job.salaryMin ?? undefined,
    salaryMax: application.job.salaryMax ?? undefined,
    workMode: application.job.workMode?.toLowerCase() as "remote" | "hybrid" | "on_site" | "flexible" | undefined,
    seniority: application.job.seniority?.toLowerCase() as "entry" | "mid" | "senior" | undefined,
    seniorityConfidence: application.job.seniorityConfidence ?? undefined,
  };

  const profile = {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gender: (application.user.profile as any).gender ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethnicity: (application.user.profile as any).ethnicity ?? undefined,
    school: application.user.profile.school ?? "",
    degree: application.user.profile.degree ?? "",
    graduationDate: application.user.profile.graduationDate?.toISOString().slice(0, 10) ?? "",
    yearsOfExperience: application.user.profile.yearsOfExperience ?? 0,
    currentCompany: application.user.profile.currentCompany ?? "",
    currentTitle: application.user.profile.currentTitle ?? "",
  };

  const preferences = {
    workModes: (prefs?.workModes ?? ["remote"]).map((m) => m.toLowerCase()) as ("remote" | "hybrid" | "on_site" | "flexible")[],
    targetRoles: prefs?.targetRoles ?? [],
    locations: prefs?.targetLocations ?? [],
  };

  // Run all three LLM tasks: tailor resume, generate answers, resolve form questions
  const [tailoredResume, fieldOverrides] = await Promise.all([
    tailorService.tailor({ job, resumeText: application.resume.baseText ?? "" }),
    formQuestions.length > 0
      ? questionService.resolve({ questions: formQuestions, profile, preferences })
      : Promise.resolve({}),
  ]);

  const generatedAnswers = await answerService.generate({ job, profile, tailoredResume });

  // Persist fresh artifacts back to DB
  await replaceTailoredArtifacts({
    applicationId: application.id,
    userId: user.id,
    jobId: application.job.id,
    resumeId: application.resume.id,
    tailoredResume,
    generatedAnswers,
  });

  return NextResponse.json({
    ok: true,
    tailoredResume,
    generatedAnswers: generatedAnswers.items,
    fieldOverrides, // LLM-resolved answers keyed by exact form label
  });
}
