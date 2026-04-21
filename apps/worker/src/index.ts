import { createExecutionPlan } from "@jobhunter/automation";
import type { StructuredProfile } from "@jobhunter/core";
import { MockJobSource } from "@jobhunter/job-sources";
import {
  JobScorerService,
  ResumeTailorService,
  ShortAnswerGeneratorService,
} from "@jobhunter/llm";

const profile: StructuredProfile = {
  fullLegalName: "Demo Candidate",
  email: "demo@jobhunter.local",
  phone: "2065550182",
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
  graduationDate: "2025-06-15",
  yearsOfExperience: 3,
  currentCompany: "GE Vernova",
  currentTitle: "Software Engineering Intern",
};

async function main(): Promise<void> {
  const source = new MockJobSource();
  const scorer = new JobScorerService();
  const tailor = new ResumeTailorService();
  const answerGenerator = new ShortAnswerGeneratorService();

  const jobs = await source.discoverJobs();
  console.log(`[worker] discovered ${jobs.length} job(s) from ${source.name}`);

  for (const job of jobs) {
    const score = await scorer.score({
      job,
      profile,
      resumeText:
        "Software engineer with backend, automation, cloud deployment, testing, and integration experience.",
      threshold: 70,
    });

    const tailoredResume = await tailor.tailor({
      job,
      resumeText:
        "Software engineer with backend, automation, cloud deployment, testing, and integration experience.",
    });

    const generatedAnswers = await answerGenerator.generate({
      job,
      profile,
      tailoredResume,
    });

    const executionPlan = createExecutionPlan({
      confidence: score.confidence,
      simpleAndPredictableFlow: score.fitScore >= 85,
      checkpoint: null,
    });

    console.log(
      JSON.stringify(
        {
          company: job.company,
          title: job.title,
          fitScore: score.fitScore,
          decision: score.decision,
          nextStatus: executionPlan.status,
          generatedAnswers: generatedAnswers.items.length,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exit(1);
});
