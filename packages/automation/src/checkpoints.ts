import type { ApplicationCheckpoint, ManualActionType } from "@jobhunter/core";

import { manualActionTypes } from "@jobhunter/core";

const checkpointMatchers: Array<{
  type: ManualActionType;
  fragments: string[];
}> = [
  {
    type: "captcha",
    fragments: ["captcha", "recaptcha", "turnstile", "hcaptcha", "arkose"],
  },
  {
    type: "email_verification_code",
    fragments: ["verification code", "confirmation code", "check your email", "one-time code"],
  },
  {
    type: "security_verification",
    fragments: ["verify your identity", "two factor", "2fa", "security check"],
  },
  {
    type: "upload_failure",
    fragments: ["upload failed", "resume upload failed", "try uploading again"],
  },
  {
    type: "unknown_form_structure",
    fragments: ["unsupported form", "unexpected field", "custom widget"],
  },
  {
    type: "ambiguous_submit_state",
    fragments: ["please confirm submission", "pending submission", "review before submit"],
  },
];

export function detectCheckpointFromText(pageText: string): ApplicationCheckpoint | null {
  const normalized = pageText.toLowerCase();

  for (const matcher of checkpointMatchers) {
    if (matcher.fragments.some((fragment) => normalized.includes(fragment))) {
      return {
        manualActionType: matcher.type,
        reason: `Detected ${matcher.type.replaceAll("_", " ")} during application automation.`,
        preparedFields: {},
      };
    }
  }

  return null;
}

export function isKnownManualActionType(value: string): value is ManualActionType {
  return manualActionTypes.includes(value as ManualActionType);
}
