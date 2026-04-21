import type { ApplicationCheckpoint } from "@jobhunter/core";

import {
  applicationStatusSchema,
  shouldAutoSubmit,
} from "@jobhunter/core";
import type { Page } from "playwright";

import { detectCheckpointFromText } from "./checkpoints";

export type ApplyExecutionPlan = {
  status: ReturnType<typeof applicationStatusSchema.parse>;
  shouldSubmit: boolean;
  checkpoint: ApplicationCheckpoint | null;
  reason: string;
};

export async function inspectPageForCheckpoint(page: Page): Promise<ApplicationCheckpoint | null> {
  const text = await page.locator("body").innerText().catch(() => "");
  return detectCheckpointFromText(text);
}

export function createExecutionPlan(input: {
  confidence: number;
  simpleAndPredictableFlow: boolean;
  checkpoint: ApplicationCheckpoint | null;
}): ApplyExecutionPlan {
  const shouldSubmit = shouldAutoSubmit(input);

  if (input.checkpoint) {
    return {
      status: "needs_user_action",
      shouldSubmit: false,
      checkpoint: input.checkpoint,
      reason: input.checkpoint.reason,
    };
  }

  return {
    status: shouldSubmit ? "auto_submitted" : "prepared",
    shouldSubmit,
    checkpoint: null,
    reason: shouldSubmit
      ? "Flow is simple and confidence is high enough for autonomous submit."
      : "Prepared successfully, but submit confidence is not high enough yet.",
  };
}
