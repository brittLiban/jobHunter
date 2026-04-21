import type { DashboardSnapshot } from "./domain";

export const demoDashboardSnapshot: DashboardSnapshot = {
  overview: {
    jobsFound: 148,
    aboveThreshold: 32,
    queued: 14,
    prepared: 9,
    autoSubmitted: 11,
    needsUserAction: 3,
  },
  applications: [
    {
      id: "app_1",
      company: "Vercel",
      role: "Software Engineer, Integrations",
      source: "Ashby",
      fitScore: 91,
      status: "auto_submitted",
      updatedAt: "2026-04-21T09:15:00.000Z",
      generatedAnswersCount: 3,
    },
    {
      id: "app_2",
      company: "Figma",
      role: "Backend Engineer",
      source: "Greenhouse",
      fitScore: 88,
      status: "prepared",
      updatedAt: "2026-04-21T08:48:00.000Z",
      generatedAnswersCount: 2,
    },
    {
      id: "app_3",
      company: "Stripe",
      role: "Software Engineer, New Grad",
      source: "Company Site",
      fitScore: 84,
      status: "needs_user_action",
      updatedAt: "2026-04-21T07:51:00.000Z",
      generatedAnswersCount: 3,
    },
    {
      id: "app_4",
      company: "Notion",
      role: "Product Engineer",
      source: "Greenhouse",
      fitScore: 77,
      status: "queued",
      updatedAt: "2026-04-21T06:20:00.000Z",
      generatedAnswersCount: 0,
    },
  ],
  notifications: [
    {
      type: "success",
      title: "11 applications auto-submitted today",
      message: "Simple flows were completed automatically and confirmation states were captured.",
      createdAt: "2026-04-21T09:20:00.000Z",
    },
    {
      type: "action_required",
      title: "Stripe needs manual completion",
      message: "A verification prompt interrupted the apply flow. Resume data is preserved for a quick handoff.",
      createdAt: "2026-04-21T07:52:00.000Z",
    },
  ],
};
